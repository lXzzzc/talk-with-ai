package org.xzzz.service.voice;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.function.Consumer;

/** 百炼实时 ASR：密钥只在本地 Java 后端，浏览器只连接自己的后端。 */
@Component
public class RealtimeAsrClient {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(12)).build();
    private final String apiKey;
    private final URI endpoint;

    public RealtimeAsrClient(@Value("${aliyun.model-studio.api-key:}") String apiKey,
            @Value("${voice.asr-url:}") String asrUrl,
            @Value("${aliyun.model-studio.chat-url}") String chatUrl,
            @Value("${voice.asr-model:qwen3-asr-flash-realtime}") String model) {
        this.apiKey = apiKey;
        this.endpoint = endpoint(asrUrl, chatUrl, model);
    }

    static URI endpoint(String override, String chatUrl, String model) {
        URI base = URI.create(override == null || override.isBlank()
                ? "wss://" + URI.create(chatUrl).getHost() + "/api-ws/v1/realtime" : override.trim());
        if (!"wss".equals(base.getScheme()) || base.getHost() == null || base.getRawQuery() != null
                || !model.matches("[a-zA-Z0-9._-]+")) {
            throw new IllegalArgumentException("实时识别地址必须是无查询参数的 wss 地址，模型名无效时也会拒绝启动");
        }
        return URI.create(base + "?model=" + model);
    }

    public CompletableFuture<Connection> connect(Consumer<JsonNode> events, Consumer<String> error) {
        if (apiKey == null || apiKey.isBlank()) {
            return CompletableFuture.failedFuture(new IllegalStateException("缺少 DASHSCOPE_API_KEY"));
        }
        Connection connection = new Connection(events, error);
        return http.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(12))
                .header("Authorization", "Bearer " + apiKey)
                .buildAsync(endpoint, connection).thenApply(ws -> connection);
    }

    public static final class Connection implements WebSocket.Listener, AutoCloseable {
        private final Consumer<JsonNode> events;
        private final Consumer<String> error;
        private final StringBuilder pendingText = new StringBuilder();
        private WebSocket socket;
        private CompletableFuture<WebSocket> sends;
        private int pendingSends;
        private volatile boolean closed;

        Connection(Consumer<JsonNode> events, Consumer<String> error) {
            this.events = events;
            this.error = error;
        }

        @Override
        public void onOpen(WebSocket webSocket) {
            socket = webSocket;
            sends = CompletableFuture.completedFuture(webSocket);
            send(Map.of("type", "session.update", "event_id", UUID.randomUUID().toString(), "session",
                    Map.of("input_audio_format", "pcm", "sample_rate", 16000,
                            "input_audio_transcription", Map.of("language", "zh"),
                            "turn_detection", Map.of("type", "server_vad", "threshold", 0.2,
                                    "silence_duration_ms", 700))));
            webSocket.request(1);
        }

        public void append(byte[] pcm) {
            send(Map.of("type", "input_audio_buffer.append", "event_id", UUID.randomUUID().toString(),
                    "audio", Base64.getEncoder().encodeToString(pcm)));
        }

        private synchronized void send(Map<String, Object> event) {
            if (closed) return;
            // JDK WebSocket 不允许两个 sendText 同时进行；限制排队，弱网不会无限积压录音。
            if (++pendingSends > 64) {
                close();
                error.accept("语音上传拥堵，请检查网络后重新拨打");
                return;
            }
            sends = sends.thenCompose(ws -> ws.sendText(JSON.writeValueAsString(event), true));
            sends.whenComplete((ws, failure) -> {
                synchronized (this) { pendingSends--; }
                if (failure != null && !closed) {
                    close();
                    error.accept("实时识别连接中断，请重新拨打");
                }
            });
        }

        @Override
        public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
            pendingText.append(data);
            if (pendingText.length() > 131072) {
                close();
                error.accept("实时识别返回了过大的消息");
            } else if (last) {
                try { events.accept(JSON.readTree(pendingText.toString())); }
                catch (Exception e) { error.accept("无法解析实时识别响应"); }
                pendingText.setLength(0);
            }
            ws.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onClose(WebSocket ws, int code, String reason) {
            if (!closed) {
                closed = true;
                error.accept("实时识别会话已结束，请重新拨打");
            }
            return null;
        }

        @Override
        public void onError(WebSocket ws, Throwable cause) {
            if (!closed) {
                closed = true;
                error.accept("实时识别连接异常，请重新拨打");
            }
        }

        @Override
        public synchronized void close() {
            closed = true;
            if (socket != null) socket.abort();
        }
    }
}
