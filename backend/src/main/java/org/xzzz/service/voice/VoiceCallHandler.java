package org.xzzz.service.voice;

import com.convai.voice.sdk.SentenceEvent;
import com.convai.voice.sdk.realtime.SynthesisListener;
import com.convai.voice.sdk.realtime.SynthesisSession;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.xzzz.entity.dto.ClientContext;
import org.xzzz.service.ChatHistoryService;
import org.xzzz.service.XiLianChatService;
import org.xzzz.service.tts.TtsService;
import reactor.core.Disposable;
import reactor.core.Disposables;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

/** 一条浏览器连接对应一个 ASR 会话，每轮回答对应独立的模型订阅和 TTS 会话。 */
@Component
@RequiredArgsConstructor
public class VoiceCallHandler extends AbstractWebSocketHandler {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final RealtimeAsrClient asrClient;
    private final XiLianChatService chatService;
    private final ChatHistoryService history;
    private final TtsService tts;
    private final Map<String, Call> calls = new ConcurrentHashMap<>();
    private final ScheduledExecutorService watchdog = Executors.newSingleThreadScheduledExecutor(
            Thread.ofPlatform().daemon().name("voice-watchdog").factory());

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        synchronized (calls) {
            if (calls.size() >= 8) {
                session.close(CloseStatus.POLICY_VIOLATION.withReason("语音通话已达并发上限"));
                return;
            }
            session.setBinaryMessageSizeLimit(16384);
            session.setTextMessageSizeLimit(8192);
            Call call = new Call(new ConcurrentWebSocketSessionDecorator(session, 5000, 1048576));
            calls.put(session.getId(), call);
            call.timeout = watchdog.scheduleAtFixedRate(() -> call.execute(call::checkTimeout), 5, 5, TimeUnit.SECONDS);
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        Call call = calls.get(session.getId());
        if (call != null) call.execute(() -> {
            try { call.control(JSON.readTree(message.getPayload())); }
            catch (IllegalArgumentException e) { call.fail(e.getMessage()); }
            catch (Exception e) { call.fail("通话处理失败，请挂断后重试"); }
        });
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) {
        Call call = calls.get(session.getId());
        if (call == null || !call.ready || call.closed) return;
        byte[] bytes = new byte[message.getPayloadLength()];
        message.getPayload().get(bytes);
        if (bytes.length == 0 || bytes.length > 16384 || (bytes.length & 1) != 0) {
            call.execute(() -> call.fail("录音分片格式不正确"));
            return;
        }
        // 16 kHz / 16 bit 单声道约 32 KB/s，额外容忍一次突发；拒绝无限量上传。
        if (!call.acceptAudio(bytes.length)) {
            call.execute(() -> call.fail("录音发送过快，请重新拨打"));
            return;
        }
        RealtimeAsrClient.Connection upstream = call.asr;
        if (upstream != null) upstream.append(bytes);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Call call = calls.remove(session.getId());
        if (call != null) call.execute(call::close);
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        Call call = calls.remove(session.getId());
        if (call != null) call.execute(call::close);
    }

    @PreDestroy
    public void shutdown() {
        calls.values().forEach(call -> call.execute(call::close));
        watchdog.shutdownNow();
    }

    private final class Call {
        private final WebSocketSession session;
        private final ThreadPoolExecutor actor = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(256), Thread.ofVirtual().name("voice-call-", 0).factory());
        private final long created = System.nanoTime();
        private final Set<String> completedItems = new LinkedHashSet<>();
        private volatile boolean closed;
        private volatile boolean ready;
        private volatile RealtimeAsrClient.Connection asr;
        private volatile Turn current;
        private ScheduledFuture<?> timeout;
        private String userId;
        private String conversationId;
        private String weatherLocation;
        private ClientContext clientContext;
        private boolean started;
        private boolean muted;
        private long lastSpeech = System.nanoTime();
        private long audioWindow = System.nanoTime();
        private int audioBytes;

        Call(WebSocketSession session) { this.session = session; }

        void execute(Runnable task) {
            try { actor.execute(() -> {
                if (closed) return;
                try { task.run(); }
                catch (Exception e) { fail("通话处理异常，请重新拨打"); }
            }); }
            catch (RejectedExecutionException e) {
                if (!closed) {
                    closed = true;
                    if (asr != null) asr.close();
                    Turn turn = current;
                    if (turn != null) turn.cancel();
                    actor.shutdownNow();
                    if (timeout != null) timeout.cancel(false);
                    calls.remove(session.getId());
                    try { session.close(CloseStatus.SESSION_NOT_RELIABLE); } catch (IOException ignored) { }
                }
            }
        }

        synchronized boolean acceptAudio(int count) {
            long now = System.nanoTime();
            if (now - audioWindow >= TimeUnit.SECONDS.toNanos(1)) { audioWindow = now; audioBytes = 0; }
            audioBytes += count;
            return audioBytes <= 96000;
        }

        void control(JsonNode data) {
            String type = data.path("type").asText("");
            if ("start".equals(type)) {
                if (started) throw new IllegalArgumentException("通话已经开始");
                userId = field(data, "userId", 64, true);
                conversationId = field(data, "conversationId", 128, true);
                updateContext(data);
                started = true;
                asrClient.connect(event -> execute(() -> upstreamEvent(event)), reason -> execute(() -> fail(reason)))
                        .whenComplete((connection, failure) -> {
                            if (failure != null) execute(() -> fail("无法连接实时语音识别，请检查百炼配置、模型权限和网络"));
                            else {
                                synchronized (this) {
                                    if (closed) connection.close();
                                    else asr = connection;
                                }
                            }
                        });
                return;
            }
            if ("end".equals(type)) { close(); return; }
            if (!started) throw new IllegalArgumentException("请先初始化通话");
            switch (type) {
                case "context.update" -> updateContext(data);
                case "mute" -> muted = data.path("muted").asBoolean();
                case "interrupt" -> interrupt();
                case "playback.ack" -> {
                    Turn turn = current;
                    if (turn != null && turn.id.equals(data.path("turnId").asText())) {
                        turn.ack(data.path("samples").asLong());
                        if (turn.audioDone && turn.ackSamples >= turn.samples.get()) finishTurn(false);
                    }
                }
                case "text" -> {
                    if (!ready) throw new IllegalArgumentException("语音连接尚未准备好");
                    answer(field(data, "text", 4000, true));
                }
                case "ping" -> send("pong", Map.of());
                default -> throw new IllegalArgumentException("不支持的通话事件");
            }
        }

        void updateContext(JsonNode data) {
            weatherLocation = field(data, "weatherLocation", 100, false);
            String app = field(data.path("clientContext"), "recentApplication", 100, false);
            clientContext = app.isBlank() ? null : new ClientContext(app, null);
        }

        void upstreamEvent(JsonNode event) {
            switch (event.path("type").asText()) {
                case "session.updated" -> {
                    ready = true;
                    send("ready", Map.of("inputSampleRate", 16000, "outputSampleRate", 24000));
                }
                case "input_audio_buffer.speech_started" -> {
                    if (muted) return;
                    lastSpeech = System.nanoTime();
                    interrupt();
                    send("speech.start", Map.of());
                }
                case "input_audio_buffer.speech_stopped" -> { if (!muted) send("speech.stop", Map.of()); }
                case "conversation.item.input_audio_transcription.text" -> {
                    if (!muted) send("transcript.partial", Map.of("text",
                            event.path("text").asText("") + event.path("stash").asText("")));
                }
                case "conversation.item.input_audio_transcription.completed" -> {
                    if (muted) return;
                    String itemId = event.path("item_id").asText("");
                    if (!itemId.isBlank() && !completedItems.add(itemId)) return;
                    if (completedItems.size() > 256) completedItems.remove(completedItems.iterator().next());
                    String text = event.path("transcript").asText("").trim();
                    if (!text.isEmpty()) answer(text);
                    else send("listening", Map.of());
                }
                case "error" -> fail("实时识别服务返回错误（"
                        + event.path("error").path("code").asText("unknown") + "），请检查模型权限或重新拨打");
                case "session.finished" -> fail("识别会话已结束，请重新拨打");
                default -> { }
            }
        }

        void answer(String text) {
            if (text.length() > 4000) { fail("这句话过长，请分成几句说"); return; }
            finishTurn(true);
            lastSpeech = System.nanoTime();
            Turn turn = new Turn();
            current = turn;
            String turnLocation = weatherLocation;
            ClientContext turnContext = clientContext;
            send("transcript.final", Map.of("text", text, "turnId", turn.id));
            turn.worker = Thread.ofVirtual().name("voice-tts").start(() -> synthesize(turn));
            // 数据库读写不占用 ASR 回调或 WebSocket 接收线程。
            turn.generation = Thread.ofVirtual().name("voice-generation").start(() -> {
                try {
                    if (turn.cancelled) return;
                    Disposable disposable = chatService.chatForVoice(userId, conversationId, text,
                                    turnLocation, turnContext)
                            .subscribe(delta -> execute(() -> {
                                if (current != turn) return;
                                turn.generated.append(delta);
                                send("reply.delta", Map.of("turnId", turn.id, "text", delta));
                                for (String sentence : turn.buffer.append(delta)) turn.enqueue(sentence);
                            }), error -> execute(() -> {
                                if (current != turn) return;
                                send("turn.error", Map.of("message", "回答生成失败，请再说一次", "turnId", turn.id));
                                finishTurn(true);
                            }), () -> execute(() -> {
                                if (current != turn) return;
                                turn.enqueue(turn.buffer.finish());
                                turn.enqueue(Turn.END);
                                send("reply.done", Map.of("turnId", turn.id));
                            }));
                    turn.subscription.update(disposable);
                } catch (Exception e) {
                    execute(() -> {
                        if (current == turn) {
                            send("turn.error", Map.of("message", "无法生成回答，请重试", "turnId", turn.id));
                            finishTurn(true);
                        }
                    });
                }
            });
        }

        void synthesize(Turn turn) {
            try (SynthesisSession synthesis = tts.openStreamingSession(new SynthesisListener() {
                @Override public void onAudio(byte[] audio) {
                    if (turn.cancelled || closed || current != turn) return;
                    turn.samples.addAndGet(audio.length / 2);
                    send("audio.delta", Map.of("turnId", turn.id,
                            "audio", Base64.getEncoder().encodeToString(audio)));
                }
                @Override public void onSentence(SentenceEvent event) {
                    if (event.type() != SentenceEvent.Type.SENTENCE_END) return;
                    long endSample = turn.samples.get();
                    execute(() -> {
                        if (current != turn) return;
                        turn.sentenceText.append(event.originalText());
                        turn.receipts.put(endSample, turn.sentenceText.toString());
                        turn.ack(turn.ackSamples);
                    });
                }
            })) {
                while (!turn.cancelled) {
                    String text = turn.text.poll(30, TimeUnit.SECONDS);
                    if (text == null) throw new IllegalStateException("语音生成超时");
                    if (text.equals(Turn.END)) break;
                    synthesis.write(text);
                }
                if (turn.cancelled) { synthesis.cancel(); return; }
                synthesis.finish();
                execute(() -> {
                    if (current != turn) return;
                    turn.audioDone = true;
                    if (turn.samples.get() > 0) {
                        turn.receipts.put(turn.samples.get(), turn.generated.toString());
                        turn.ack(turn.ackSamples);
                    }
                    send("audio.done", Map.of("turnId", turn.id, "samples", turn.samples.get()));
                    if (turn.samples.get() == 0) {
                        send("turn.error", Map.of("turnId", turn.id, "message", "未能生成语音，文字回复仍可查看"));
                        finishTurn(true);
                    } else if (turn.ackSamples >= turn.samples.get()) finishTurn(false);
                });
            } catch (Exception e) {
                if (!turn.cancelled) execute(() -> {
                    if (current == turn) {
                        send("turn.error", Map.of("turnId", turn.id, "message", "语音合成中断，文字回复仍可查看"));
                        finishTurn(true);
                    }
                });
            }
        }

        void interrupt() {
            if (current == null) return;
            String id = current.id;
            finishTurn(true);
            send("interrupted", Map.of("turnId", id));
        }

        void finishTurn(boolean interrupted) {
            Turn turn = current;
            if (turn == null) return;
            current = null;
            turn.cancel();
            // 只将客户端已确认播放完的句子保存到记忆；未听到的生成内容不会假装说过。
            if (!turn.heard.isBlank()) {
                try {
                    history.save(userId, conversationId, "assistant", turn.heard
                            + (interrupted ? "\n（语音回复被打断）" : ""));
                } catch (Exception e) { send("notice", Map.of("message", "本轮语音记录保存失败")); }
            }
            send("turn.end", Map.of("turnId", turn.id, "interrupted", interrupted));
        }

        void checkTimeout() {
            long age = System.nanoTime() - created;
            if (!ready && age > Duration.ofSeconds(25).toNanos()) fail("语音连接超时，请重新拨打");
            else if (age > Duration.ofMinutes(30).toNanos()) fail("本次通话已满 30 分钟，请重新拨打");
            else if (ready && current == null && System.nanoTime() - lastSpeech > Duration.ofMinutes(3).toNanos())
                fail("较长时间没有说话，已自动结束通话");
        }

        void fail(String message) { send("error", Map.of("message", message)); close(); }

        void send(String type, Map<String, ?> fields) {
            if (closed || !session.isOpen()) return;
            Map<String, Object> event = new LinkedHashMap<>(fields);
            event.put("type", type);
            try { session.sendMessage(new TextMessage(JSON.writeValueAsString(event))); }
            catch (Exception e) { execute(this::close); }
        }

        void close() {
            if (closed) return;
            finishTurn(true);
            synchronized (this) {
                closed = true;
                ready = false;
                if (asr != null) asr.close();
            }
            if (timeout != null) timeout.cancel(false);
            calls.remove(session.getId());
            try { session.close(CloseStatus.NORMAL); } catch (IOException ignored) { }
            actor.shutdown();
        }
    }

    static String field(JsonNode data, String name, int max, boolean required) {
        JsonNode node = data.path(name);
        if (!node.isMissingNode() && !node.isNull() && !node.isString())
            throw new IllegalArgumentException(name + " 必须是字符串");
        String value = node.asText("").trim();
        if ((required && value.isEmpty()) || value.length() > max)
            throw new IllegalArgumentException(name + " 为空或过长");
        return value;
    }

    private static final class Turn {
        static final String END = "\u0000END";
        final String id = UUID.randomUUID().toString();
        final BlockingQueue<String> text = new ArrayBlockingQueue<>(128);
        final Disposable.Swap subscription = Disposables.swap();
        final VoiceTextBuffer buffer = new VoiceTextBuffer();
        final StringBuilder generated = new StringBuilder();
        final StringBuilder sentenceText = new StringBuilder();
        final NavigableMap<Long, String> receipts = new TreeMap<>();
        final AtomicLong samples = new AtomicLong();
        volatile boolean cancelled;
        Thread worker;
        Thread generation;
        boolean audioDone;
        long ackSamples;
        String heard = "";

        void enqueue(String value) {
            if (!value.isEmpty() && !text.offer(value)) throw new IllegalStateException("语音合成队列已满");
        }
        void ack(long samplesPlayed) {
            if (samplesPlayed < ackSamples || samplesPlayed > samples.get()) return;
            ackSamples = samplesPlayed;
            Map.Entry<Long, String> receipt = receipts.floorEntry(ackSamples);
            if (receipt != null) heard = receipt.getValue();
        }
        void cancel() {
            cancelled = true;
            subscription.dispose();
            if (generation != null) generation.interrupt();
            if (worker != null) worker.interrupt();
            text.clear();
        }
    }
}
