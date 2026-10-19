package org.xzzz.service.tts;

import com.convai.voice.sdk.AudioFormat;
import com.convai.voice.sdk.SynthesisAudio;
import com.convai.voice.sdk.SynthesisOptions;
import com.convai.voice.sdk.realtime.VoiceRealtimeClient;
import com.convai.voice.sdk.realtime.SynthesisListener;
import com.convai.voice.sdk.realtime.SynthesisSession;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.xzzz.exception.TtsException;
import org.xzzz.util.AudioCache;

/** 阿里云 Voice Studio 实时语音合成服务。 */
@Slf4j
@Service
public class TtsService {
    private final AudioCache audioCache;
    private final String voiceId;
    private final double rate;
    private final double pitch;
    private final VoiceRealtimeClient client;
    private final SynthesisOptions options;

    public TtsService(
            AudioCache audioCache,
            @Value("${tts.aliyun.endpoint:wss://convai-platform.aliyuncs.com/api-ws/v1/inference}") String endpoint,
            @Value("${tts.aliyun.api-key:}") String apiKey,
            @Value("${tts.aliyun.voice-id:}") String voiceId,
            @Value("${tts.aliyun.sample-rate:22050}") int sampleRate,
            @Value("${tts.aliyun.rate:1.0}") double rate,
            @Value("${tts.aliyun.pitch:1.0}") double pitch) {
        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalStateException("缺少 TTS_ALIYUN_API_KEY");
        }
        if (voiceId == null || voiceId.isBlank()) {
            throw new IllegalStateException("缺少 TTS_ALIYUN_VOICE_ID");
        }
        this.audioCache = audioCache;
        this.voiceId = voiceId;
        this.rate = rate;
        this.pitch = pitch;
        this.client = VoiceRealtimeClient.builder()
                .endpoint(endpoint)
                .apiKey(apiKey)
                .userAgent("talk-with-ai/aliyun-tts")
                .finishTimeoutMillis(180_000L)
                .build();
        this.options = SynthesisOptions.builder()
                .voice(voiceId)
                .format(AudioFormat.WAV)
                .sampleRate(sampleRate)
                .rate(rate)
                .pitch(pitch)
                .build();
        log.info("Aliyun Voice Studio TTS ready: endpoint={}, voice={}, sampleRate={}",
                endpoint, voiceId, sampleRate);
    }

    @PreDestroy
    public void shutdown() {
        client.close();
    }

    /** 通话使用裸 PCM 分片，避免等待完整 WAV；每轮由调用者关闭独立会话。 */
    public SynthesisSession openStreamingSession(SynthesisListener listener) {
        return client.newSession(SynthesisOptions.builder()
                .voice(voiceId).format(AudioFormat.PCM).sampleRate(24000)
                .rate(rate).pitch(pitch).build(), listener);
    }

    public byte[] synthesize(String text) {
        if (text == null || text.isBlank()) {
            return new byte[0];
        }
        String normalized = text.replaceAll("\\s*\\R\\s*", " ").trim();
        String cacheKey = voiceId + '\u0000' + rate + '\u0000' + pitch + '\u0000' + normalized;
        byte[] cached = audioCache.get(cacheKey);
        if (cached != null) {
            return cached;
        }
        try {
            SynthesisAudio result = client.synthesize(options, normalized);
            byte[] audio = result.audio();
            if (audio == null || audio.length == 0) {
                throw new TtsException("阿里云 TTS 返回了空音频");
            }
            audioCache.put(cacheKey, audio);
            log.debug("Aliyun TTS synthesized {} chars -> {} bytes", normalized.length(), audio.length);
            return audio;
        } catch (TtsException e) {
            throw e;
        } catch (Exception e) {
            throw new TtsException("阿里云 TTS 合成失败：" + e.getMessage(), e);
        }
    }
}
