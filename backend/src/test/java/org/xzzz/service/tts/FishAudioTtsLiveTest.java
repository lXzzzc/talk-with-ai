package org.xzzz.service.tts;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/** Opt-in smoke test: FISH_AUDIO_LIVE_TEST=true mvn -Dtest=FishAudioTtsLiveTest test. */
@EnabledIfEnvironmentVariable(named = "FISH_AUDIO_LIVE_TEST", matches = "true")
class FishAudioTtsLiveTest {
    @Test void streamsRaw24KhzPcmWithTheConfiguredVoice() {
        FishAudioTtsProvider provider = new FishAudioTtsProvider(
                "https://api.fish.audio/v1/tts",
                System.getenv("TTS_FISH_API_KEY"),
                System.getenv("TTS_FISH_REFERENCE_ID"),
                System.getenv().getOrDefault("TTS_FISH_MODEL", "drama-3"),
                1.0, Duration.ofSeconds(60),
                System.getenv("TTS_FISH_PROXY_HOST"),
                Integer.parseInt(System.getenv().getOrDefault("TTS_FISH_PROXY_PORT", "0")));
        AtomicLong bytes = new AtomicLong();
        AtomicReference<String> completedText = new AtomicReference<>();

        try (StreamingTtsSession session = provider.openStreamingSession(new StreamingTtsListener() {
            @Override public void onAudio(byte[] audio) { bytes.addAndGet(audio.length); }
            @Override public void onSentence(String text) { completedText.set(text); }
        })) {
            session.write("你好，这是一段实时语音测试。");
            session.finish();
        }

        assertThat(bytes.get()).isGreaterThan(1000).isEven();
        assertThat(completedText.get()).isEqualTo("你好，这是一段实时语音测试。");
    }
}
