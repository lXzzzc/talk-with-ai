package org.xzzz.service.tts;

import com.convai.voice.sdk.AudioFormat;
import com.convai.voice.sdk.SentenceEvent;
import com.convai.voice.sdk.SynthesisAudio;
import com.convai.voice.sdk.SynthesisOptions;
import com.convai.voice.sdk.realtime.SynthesisListener;
import com.convai.voice.sdk.realtime.SynthesisSession;
import com.convai.voice.sdk.realtime.VoiceRealtimeClient;
import org.xzzz.exception.TtsException;

final class AliyunTtsProvider implements TtsProvider {
    private final String voiceId;
    private final double rate;
    private final double pitch;
    private final VoiceRealtimeClient client;
    private final SynthesisOptions options;

    AliyunTtsProvider(String endpoint, String apiKey, String voiceId,
                      int sampleRate, double rate, double pitch) {
        this.voiceId = voiceId == null ? "" : voiceId.trim();
        this.rate = rate;
        this.pitch = pitch;
        if (apiKey == null || apiKey.isBlank() || this.voiceId.isBlank()) {
            client = null;
            options = null;
            return;
        }
        client = VoiceRealtimeClient.builder()
                .endpoint(endpoint)
                .apiKey(apiKey)
                .userAgent("talk-with-ai/aliyun-tts")
                .finishTimeoutMillis(180_000L)
                .build();
        options = SynthesisOptions.builder()
                .voice(this.voiceId)
                .format(AudioFormat.WAV)
                .sampleRate(sampleRate)
                .rate(rate)
                .pitch(pitch)
                .build();
    }

    @Override public String name() { return "aliyun"; }

    @Override public boolean available() { return client != null; }

    @Override public String cacheKey(String text) {
        return name() + '\0' + voiceId + '\0' + rate + '\0' + pitch + '\0' + text;
    }

    @Override public byte[] synthesize(String text) {
        requireAvailable();
        try {
            SynthesisAudio result = client.synthesize(options, text);
            byte[] audio = result.audio();
            if (audio == null || audio.length == 0) throw new TtsException("阿里云 TTS 返回了空音频");
            return audio;
        } catch (TtsException e) {
            throw e;
        } catch (Exception e) {
            throw new TtsException("阿里云 TTS 合成失败：" + e.getMessage(), e);
        }
    }

    @Override public StreamingTtsSession openStreamingSession(StreamingTtsListener listener) {
        requireAvailable();
        SynthesisSession session = client.newSession(SynthesisOptions.builder()
                .voice(voiceId).format(AudioFormat.PCM).sampleRate(24000)
                .rate(rate).pitch(pitch).build(), new SynthesisListener() {
                    @Override public void onAudio(byte[] audio) { listener.onAudio(audio); }

                    @Override public void onSentence(SentenceEvent event) {
                        if (event.type() == SentenceEvent.Type.SENTENCE_END) {
                            listener.onSentence(event.originalText());
                        }
                    }
                });
        return new StreamingTtsSession() {
            @Override public void write(String text) { session.write(text); }
            @Override public void finish() { session.finish(); }
            @Override public void cancel() { session.cancel(); }
            @Override public void close() { session.close(); }
        };
    }

    @Override public void close() {
        if (client != null) client.close();
    }

    private void requireAvailable() {
        if (!available()) throw new TtsException("阿里云 TTS 未配置");
    }
}
