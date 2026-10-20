package org.xzzz.service.voice;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.socket.*;
import org.xzzz.service.ChatHistoryService;
import org.xzzz.service.XiLianChatService;
import org.xzzz.service.tts.StreamingTtsSession;
import org.xzzz.service.tts.TtsService;
import reactor.core.publisher.Flux;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class VoiceCallHandlerTest {
    private final RealtimeAsrClient asr = mock(RealtimeAsrClient.class);
    private final XiLianChatService chat = mock(XiLianChatService.class);
    private final ChatHistoryService history = mock(ChatHistoryService.class);
    private final TtsService tts = mock(TtsService.class);
    private final VoiceCallHandler handler = new VoiceCallHandler(asr, chat, history, tts);
    private final JsonMapper json = JsonMapper.builder().build();

    @AfterEach void close() { handler.shutdown(); }

    @Test void rejectsMissingIdentityWithoutOpeningAnUpstreamConnection() throws Exception {
        WebSocketSession session = session(new CopyOnWriteArrayList<>());
        handler.afterConnectionEstablished(session);
        handler.handleMessage(session, new TextMessage("{\"type\":\"start\",\"userId\":\"\",\"conversationId\":\"chat-test\"}"));
        verify(session, timeout(2000)).close(CloseStatus.NORMAL);
        verifyNoInteractions(asr);
    }

    @Test void deduplicatesAsrFinalsCancelsGenerationAndClosesAsrOnHangup() throws Exception {
        var packets = new CopyOnWriteArrayList<String>();
        WebSocketSession session = session(packets);
        RealtimeAsrClient.Connection connection = mock(RealtimeAsrClient.Connection.class);
        when(asr.connect(any(), any())).thenReturn(CompletableFuture.completedFuture(connection));
        when(chat.chatForVoice(anyString(), anyString(), anyString(), any(), any())).thenReturn(Flux.never());
        // TTS 等待文本，在取消时中断退出，不会调用任何付费服务。
        when(tts.openStreamingSession(any())).thenReturn(mock(StreamingTtsSession.class));
        handler.afterConnectionEstablished(session);
        handler.handleMessage(session, new TextMessage("{\"type\":\"start\",\"userId\":\"voice-test\",\"conversationId\":\"chat-test\"}"));
        @SuppressWarnings("unchecked") ArgumentCaptor<Consumer<JsonNode>> events = ArgumentCaptor.forClass(Consumer.class);
        verify(asr, timeout(2000)).connect(events.capture(), any());
        Consumer<JsonNode> listener = events.getValue();
        listener.accept(json.readTree("{\"type\":\"session.updated\"}"));
        var finalEvent = json.readTree("{\"type\":\"conversation.item.input_audio_transcription.completed\",\"item_id\":\"one\",\"transcript\":\"你好\"}");
        listener.accept(finalEvent);
        listener.accept(finalEvent);
        verify(chat, timeout(2000).times(1)).chatForVoice("voice-test", "chat-test", "你好", "", null);
        handler.handleMessage(session, new TextMessage("{\"type\":\"interrupt\"}"));
        handler.handleMessage(session, new TextMessage("{\"type\":\"end\"}"));
        // 先等待非同步的连接关闭；对 synchronized close 使用 Mockito timeout 会持锁阻塞被测线程。
        verify(session, timeout(2000)).close(CloseStatus.NORMAL);
        verify(connection).close();
        assertThat(packets).anyMatch(packet -> packet.contains("interrupted"));
        verifyNoInteractions(history); // 没有播放确认，绝不把未听到的回答写入记忆。
    }

    @Test void closesUpstreamIfItConnectsAfterTheUserAlreadyHungUp() throws Exception {
        WebSocketSession session = session(new CopyOnWriteArrayList<>());
        CompletableFuture<RealtimeAsrClient.Connection> connecting = new CompletableFuture<>();
        when(asr.connect(any(), any())).thenReturn(connecting);
        handler.afterConnectionEstablished(session);
        handler.handleMessage(session, new TextMessage("{\"type\":\"start\",\"userId\":\"voice-test\",\"conversationId\":\"chat-test\"}"));
        verify(asr, timeout(2000)).connect(any(), any());
        handler.handleMessage(session, new TextMessage("{\"type\":\"end\"}"));
        verify(session, timeout(2000)).close(CloseStatus.NORMAL);
        RealtimeAsrClient.Connection connection = mock(RealtimeAsrClient.Connection.class);
        connecting.complete(connection);
        verify(connection).close();
    }

    private WebSocketSession session(CopyOnWriteArrayList<String> packets) throws Exception {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("test-call");
        when(session.getUri()).thenReturn(URI.create("ws://localhost/voice/realtime"));
        when(session.getAttributes()).thenReturn(Map.of());
        when(session.isOpen()).thenReturn(true);
        doAnswer(invocation -> { packets.add(((TextMessage) invocation.getArgument(0)).getPayload()); return null; })
                .when(session).sendMessage(any());
        return session;
    }
}
