package org.xzzz.service.tts;

import org.junit.jupiter.api.Test;
import org.xzzz.exception.TtsException;
import org.xzzz.util.AudioCache;

import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class TtsServiceTest {
    @Test void realtimeFallsBackWhenPrimaryRejectsBeforeSendingAudio() {
        TtsProvider primary = provider("fish");
        TtsProvider fallback = provider("aliyun");
        StreamingTtsSession primarySession = mock(StreamingTtsSession.class);
        StreamingTtsSession fallbackSession = mock(StreamingTtsSession.class);
        when(primary.openStreamingSession(any())).thenReturn(primarySession);
        when(fallback.openStreamingSession(any())).thenReturn(fallbackSession);
        doThrow(new TtsException("insufficient balance")).when(primarySession).write("你好");
        doAnswer(invocation -> {
            StreamingTtsListener listener = listenerPassedTo(fallback);
            listener.onAudio(new byte[]{1, 2, 3, 4});
            listener.onSentence("你好");
            return null;
        }).when(fallbackSession).write("你好");
        AtomicLong bytes = new AtomicLong();
        AtomicReference<String> sentence = new AtomicReference<>();
        TtsService service = new TtsService(new AudioCache(10, 1024), primary, fallback);

        try (StreamingTtsSession session = service.openStreamingSession(new StreamingTtsListener() {
            @Override public void onAudio(byte[] audio) { bytes.addAndGet(audio.length); }
            @Override public void onSentence(String text) { sentence.set(text); }
        })) {
            session.write("你好");
        }

        verify(primarySession).cancel();
        verify(fallbackSession).write("你好");
        assertThat(bytes.get()).isEqualTo(4);
        assertThat(sentence.get()).isEqualTo("你好");
    }

    @Test void realtimeDoesNotRepeatSpeechAfterPrimaryAlreadySentAudio() {
        TtsProvider primary = provider("fish");
        TtsProvider fallback = provider("aliyun");
        StreamingTtsSession primarySession = mock(StreamingTtsSession.class);
        when(primary.openStreamingSession(any())).thenAnswer(invocation -> {
            StreamingTtsListener listener = invocation.getArgument(0);
            doAnswer(ignored -> {
                listener.onAudio(new byte[]{1, 2});
                throw new TtsException("connection lost");
            }).when(primarySession).write("你好");
            return primarySession;
        });
        TtsService service = new TtsService(new AudioCache(10, 1024), primary, fallback);

        try (StreamingTtsSession session = service.openStreamingSession(audio -> { })) {
            assertThat(org.assertj.core.api.Assertions.catchThrowable(() -> session.write("你好")))
                    .isInstanceOf(TtsException.class);
        }
        verify(fallback, never()).openStreamingSession(any());
    }

    private static TtsProvider provider(String name) {
        TtsProvider provider = mock(TtsProvider.class);
        when(provider.name()).thenReturn(name);
        when(provider.available()).thenReturn(true);
        return provider;
    }

    private static StreamingTtsListener listenerPassedTo(TtsProvider provider) {
        var captor = org.mockito.ArgumentCaptor.forClass(StreamingTtsListener.class);
        verify(provider).openStreamingSession(captor.capture());
        return captor.getValue();
    }
}
