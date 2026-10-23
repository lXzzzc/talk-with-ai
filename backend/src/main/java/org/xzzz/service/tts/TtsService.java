package org.xzzz.service.tts;

import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.xzzz.exception.TtsException;
import org.xzzz.util.AudioCache;

import java.time.Duration;
import java.util.Locale;
import java.util.Map;

/** Selects the configured speech provider and keeps the former provider as an optional fallback. */
@Slf4j
@Service
public class TtsService {
    private final AudioCache audioCache;
    private final Map<String, TtsProvider> providers;
    private final TtsProvider primary;
    private final TtsProvider fallback;

    @Autowired
    public TtsService(
            AudioCache audioCache,
            @Value("${tts.provider:fish}") String provider,
            @Value("${tts.fallback-provider:}") String fallbackProvider,
            @Value("${tts.fish.endpoint:https://api.fish.audio/v1/tts}") String fishEndpoint,
            @Value("${tts.fish.api-key:}") String fishApiKey,
            @Value("${tts.fish.reference-id:}") String fishReferenceId,
            @Value("${tts.fish.model:drama-3}") String fishModel,
            @Value("${tts.fish.speed:1.0}") double fishSpeed,
            @Value("${tts.fish.timeout-seconds:60}") int fishTimeoutSeconds,
            @Value("${tts.fish.proxy-host:}") String fishProxyHost,
            @Value("${tts.fish.proxy-port:0}") int fishProxyPort,
            @Value("${tts.aliyun.endpoint:wss://convai-platform.aliyuncs.com/api-ws/v1/inference}") String aliyunEndpoint,
            @Value("${tts.aliyun.api-key:}") String aliyunApiKey,
            @Value("${tts.aliyun.voice-id:}") String aliyunVoiceId,
            @Value("${tts.aliyun.sample-rate:22050}") int aliyunSampleRate,
            @Value("${tts.aliyun.rate:1.0}") double aliyunRate,
            @Value("${tts.aliyun.pitch:1.0}") double aliyunPitch) {
        this.audioCache = audioCache;
        TtsProvider fish = new FishAudioTtsProvider(
                fishEndpoint, fishApiKey, fishReferenceId, fishModel, fishSpeed,
                Duration.ofSeconds(Math.max(10, fishTimeoutSeconds)), fishProxyHost, fishProxyPort);
        TtsProvider aliyun = new AliyunTtsProvider(
                aliyunEndpoint, aliyunApiKey, aliyunVoiceId,
                aliyunSampleRate, aliyunRate, aliyunPitch);
        providers = Map.of(fish.name(), fish, aliyun.name(), aliyun);
        primary = provider(provider);
        TtsProvider configuredFallback = fallbackProvider == null || fallbackProvider.isBlank()
                ? null : provider(fallbackProvider);
        fallback = configuredFallback == primary ? null : configuredFallback;

        log.info("TTS provider selected: primary={}, fallback={}, primaryReady={}, fallbackReady={}",
                primary.name(), fallback == null ? "none" : fallback.name(), primary.available(),
                fallback != null && fallback.available());
    }

    TtsService(AudioCache audioCache, TtsProvider primary, TtsProvider fallback) {
        this.audioCache = audioCache;
        this.primary = primary;
        this.fallback = fallback == primary ? null : fallback;
        this.providers = fallback == null || fallback == primary
                ? Map.of(primary.name(), primary)
                : Map.of(primary.name(), primary, fallback.name(), fallback);
    }

    @PreDestroy
    public void shutdown() {
        providers.values().forEach(provider -> {
            try { provider.close(); }
            catch (Exception e) { log.warn("Failed to close {} TTS provider", provider.name(), e); }
        });
    }

    /** Opens a provider-neutral streaming session that emits raw 24 kHz mono PCM. */
    public StreamingTtsSession openStreamingSession(StreamingTtsListener listener) {
        return new FailoverStreamingSession(listener);
    }

    public byte[] synthesize(String text) {
        if (text == null || text.isBlank()) return new byte[0];
        String normalized = text.replaceAll("\\s*\\R\\s*", " ").trim();
        try {
            return synthesize(primary, normalized);
        } catch (TtsException primaryError) {
            if (fallback == null || !fallback.available()) throw primaryError;
            log.warn("Primary TTS provider {} failed; using {}: {}",
                    primary.name(), fallback.name(), primaryError.getMessage());
            try {
                return synthesize(fallback, normalized);
            } catch (TtsException fallbackError) {
                fallbackError.addSuppressed(primaryError);
                throw fallbackError;
            }
        }
    }

    private byte[] synthesize(TtsProvider provider, String text) {
        if (!provider.available()) throw new TtsException(provider.name() + " TTS 未配置");
        String cacheKey = provider.cacheKey(text);
        byte[] cached = audioCache.get(cacheKey);
        if (cached != null) return cached;
        byte[] audio = provider.synthesize(text);
        audioCache.put(cacheKey, audio);
        log.debug("{} TTS synthesized {} chars -> {} bytes", provider.name(), text.length(), audio.length);
        return audio;
    }

    private StreamingTtsSession open(TtsProvider provider, StreamingTtsListener listener) {
        if (!provider.available()) throw new TtsException(provider.name() + " TTS 未配置");
        return provider.openStreamingSession(listener);
    }

    private TtsProvider provider(String name) {
        String normalized = name == null ? "" : name.trim().toLowerCase(Locale.ROOT);
        TtsProvider result = providers.get(normalized);
        if (result == null) throw new IllegalArgumentException("不支持的 TTS 提供方：" + name);
        return result;
    }

    /**
     * A WebSocket can authenticate successfully and only reject the first paid synthesis request later.
     * If that happens before any PCM has reached the client, retry the same sentence on the retained
     * fallback provider. Once audio has been emitted, switching would repeat part of a sentence, so the
     * original error is propagated instead.
     */
    private final class FailoverStreamingSession implements StreamingTtsSession {
        private final StreamingTtsListener downstream;
        private final StreamingTtsListener trackingListener;
        private TtsProvider activeProvider;
        private StreamingTtsSession active;
        private boolean audioDeliveredForWrite;

        FailoverStreamingSession(StreamingTtsListener downstream) {
            this.downstream = downstream;
            trackingListener = new StreamingTtsListener() {
                @Override public void onAudio(byte[] audio) {
                    audioDeliveredForWrite = true;
                    FailoverStreamingSession.this.downstream.onAudio(audio);
                }

                @Override public void onSentence(String text) {
                    FailoverStreamingSession.this.downstream.onSentence(text);
                }
            };
            try {
                activeProvider = primary;
                active = open(primary, trackingListener);
            } catch (TtsException primaryError) {
                switchToFallback(primaryError);
            }
        }

        @Override public void write(String text) {
            audioDeliveredForWrite = false;
            try {
                active.write(text);
            } catch (TtsException primaryError) {
                if (activeProvider != primary || audioDeliveredForWrite) throw primaryError;
                switchToFallback(primaryError);
                active.write(text);
            }
        }

        @Override public void finish() { active.finish(); }

        @Override public void cancel() { active.cancel(); }

        @Override public void close() { active.close(); }

        private void switchToFallback(TtsException primaryError) {
            if (fallback == null || !fallback.available()) throw primaryError;
            if (active != null) {
                try { active.cancel(); }
                catch (Exception ignored) { }
            }
            log.warn("Primary TTS provider {} failed before delivering realtime audio; using {}: {}",
                    primary.name(), fallback.name(), primaryError.getMessage());
            try {
                activeProvider = fallback;
                active = open(fallback, trackingListener);
            } catch (TtsException fallbackError) {
                fallbackError.addSuppressed(primaryError);
                throw fallbackError;
            }
        }
    }
}
