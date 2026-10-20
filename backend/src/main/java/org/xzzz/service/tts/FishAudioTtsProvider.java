package org.xzzz.service.tts;

import org.xzzz.exception.TtsException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.InetSocketAddress;
import java.net.ProxySelector;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Arrays;
import java.util.Map;
import java.util.Objects;

/** Fish Audio v1 TTS client. HTTP responses are streamed so realtime calls can play PCM immediately. */
final class FishAudioTtsProvider implements TtsProvider {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final int SAMPLE_RATE = 24000;

    private final HttpClient http;
    private final URI endpoint;
    private final String apiKey;
    private final String referenceId;
    private final String model;
    private final double speed;
    private final Duration timeout;

    FishAudioTtsProvider(String endpoint, String apiKey, String referenceId,
                         String model, double speed, Duration timeout,
                         String proxyHost, int proxyPort) {
        this(httpClient(proxyHost, proxyPort),
                endpoint, apiKey, referenceId, model, speed, timeout);
    }

    FishAudioTtsProvider(HttpClient http, String endpoint, String apiKey, String referenceId,
                         String model, double speed, Duration timeout) {
        this.http = Objects.requireNonNull(http);
        this.endpoint = URI.create(endpoint);
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.referenceId = referenceId == null ? "" : referenceId.trim();
        this.model = model;
        this.speed = speed;
        this.timeout = timeout;
    }

    @Override public String name() { return "fish"; }

    @Override public boolean available() { return !apiKey.isBlank() && !referenceId.isBlank(); }

    @Override public String cacheKey(String text) {
        return name() + '\0' + model + '\0' + referenceId + '\0' + speed + '\0' + text;
    }

    @Override public byte[] synthesize(String text) {
        requireAvailable();
        try {
            HttpResponse<InputStream> response = send(text, "wav", "normal");
            try (InputStream stream = response.body()) {
                ensureSuccess(response, stream);
                byte[] audio = stream.readAllBytes();
                if (audio.length == 0) throw new TtsException("Fish Audio TTS 返回了空音频");
                return audio;
            }
        } catch (TtsException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new TtsException("Fish Audio TTS 请求被中断", e);
        } catch (Exception e) {
            throw new TtsException("Fish Audio TTS 合成失败：" + e.getMessage(), e);
        }
    }

    @Override public StreamingTtsSession openStreamingSession(StreamingTtsListener listener) {
        requireAvailable();
        return new FishStreamingSession(listener);
    }

    private HttpResponse<InputStream> send(String text, String format, String latency)
            throws IOException, InterruptedException {
        String requestBody = JSON.writeValueAsString(Map.of(
                "text", text,
                "reference_id", referenceId,
                "format", format,
                "sample_rate", SAMPLE_RATE,
                "latency", latency,
                "normalize", true,
                "prosody", Map.of("speed", speed, "volume", 0, "normalize_loudness", true)));
        HttpRequest request = HttpRequest.newBuilder(endpoint)
                .timeout(timeout)
                .header("Authorization", "Bearer " + apiKey)
                .header("Content-Type", "application/json")
                .header("model", model)
                .POST(HttpRequest.BodyPublishers.ofString(requestBody))
                .build();
        return http.send(request, HttpResponse.BodyHandlers.ofInputStream());
    }

    private static void ensureSuccess(HttpResponse<?> response, InputStream body) throws IOException {
        if (response.statusCode() >= 200 && response.statusCode() < 300) return;
        byte[] errorBytes = body.readNBytes(16_384);
        String message = "上游拒绝了请求";
        try {
            JsonNode error = JSON.readTree(errorBytes);
            message = error.path("message").asText(error.path("reason").asText(message));
        } catch (Exception ignored) { }
        throw new TtsException("Fish Audio TTS HTTP " + response.statusCode() + "：" + message);
    }

    private void requireAvailable() {
        if (!available()) throw new TtsException("Fish Audio TTS 未配置");
    }

    private static HttpClient httpClient(String proxyHost, int proxyPort) {
        HttpClient.Builder builder = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15));
        if (proxyHost != null && !proxyHost.isBlank()) {
            if (proxyPort < 1 || proxyPort > 65535) {
                throw new IllegalArgumentException("TTS_FISH_PROXY_PORT 必须是 1-65535");
            }
            builder.proxy(ProxySelector.of(new InetSocketAddress(proxyHost.trim(), proxyPort)));
        }
        return builder.build();
    }

    private final class FishStreamingSession implements StreamingTtsSession {
        private final StreamingTtsListener listener;
        private volatile InputStream currentStream;
        private volatile boolean cancelled;
        private boolean finished;

        FishStreamingSession(StreamingTtsListener listener) {
            this.listener = Objects.requireNonNull(listener);
        }

        @Override public void write(String text) {
            if (finished || cancelled || text == null || text.isBlank()) return;
            try {
                HttpResponse<InputStream> response = send(text, "pcm", "balanced");
                try (InputStream stream = response.body()) {
                    currentStream = stream;
                    ensureSuccess(response, stream);
                    streamPcm(stream);
                } finally {
                    currentStream = null;
                }
                if (!cancelled) listener.onSentence(text);
            } catch (TtsException e) {
                throw e;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                if (!cancelled) throw new TtsException("Fish Audio 实时语音请求被中断", e);
            } catch (Exception e) {
                if (!cancelled) throw new TtsException("Fish Audio 实时语音生成失败：" + e.getMessage(), e);
            }
        }

        private void streamPcm(InputStream stream) throws IOException {
            byte[] buffer = new byte[8192];
            int carry = -1;
            while (!cancelled) {
                int count = stream.read(buffer);
                if (count < 0) break;
                if (count == 0) continue;
                int offset = 0;
                if (carry >= 0) {
                    listener.onAudio(new byte[]{(byte) carry, buffer[0]});
                    carry = -1;
                    offset = 1;
                }
                int evenLength = (count - offset) & ~1;
                if (evenLength > 0) {
                    listener.onAudio(Arrays.copyOfRange(buffer, offset, offset + evenLength));
                }
                if (offset + evenLength < count) carry = buffer[count - 1] & 0xff;
            }
            if (!cancelled && carry >= 0) throw new TtsException("Fish Audio 返回了无效的 PCM 数据");
        }

        @Override public void finish() { finished = true; }

        @Override public void cancel() {
            cancelled = true;
            InputStream stream = currentStream;
            if (stream != null) {
                try { stream.close(); }
                catch (IOException ignored) { }
            }
        }

        @Override public void close() {
            if (!finished) cancel();
        }
    }
}
