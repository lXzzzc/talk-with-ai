package org.xzzz.service.tts;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.xzzz.exception.TtsException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FishAudioTtsProviderTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private HttpServer server;

    @AfterEach void stopServer() {
        if (server != null) server.stop(0);
    }

    @Test void sendsReferenceIdAndReturnsRawWavResponse() throws Exception {
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicReference<String> model = new AtomicReference<>();
        AtomicReference<JsonNode> requestJson = new AtomicReference<>();
        byte[] wav = "RIFF-test-wave".getBytes(StandardCharsets.US_ASCII);
        start(exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            model.set(exchange.getRequestHeaders().getFirst("model"));
            requestJson.set(JSON.readTree(exchange.getRequestBody()));
            exchange.getResponseHeaders().set("Content-Type", "audio/wav");
            exchange.sendResponseHeaders(200, wav.length);
            exchange.getResponseBody().write(wav);
        });

        FishAudioTtsProvider provider = provider("test-key", "cloned-voice");
        assertThat(provider.synthesize("你好")).isEqualTo(wav);
        assertThat(authorization.get()).isEqualTo("Bearer test-key");
        assertThat(model.get()).isEqualTo("s2-pro");
        assertThat(requestJson.get().path("reference_id").asText()).isEqualTo("cloned-voice");
        assertThat(requestJson.get().path("format").asText()).isEqualTo("wav");
        assertThat(requestJson.get().path("sample_rate").asInt()).isEqualTo(24000);
    }

    @Test void streamsEvenLengthPcmAndSignalsSentenceCompletion() throws Exception {
        byte[] pcm = new byte[16_385];
        for (int i = 0; i < pcm.length - 1; i++) pcm[i] = (byte) i;
        start(exchange -> {
            JsonNode request = JSON.readTree(exchange.getRequestBody());
            assertThat(request.path("format").asText()).isEqualTo("pcm");
            assertThat(request.path("latency").asText()).isEqualTo("balanced");
            exchange.getResponseHeaders().set("Content-Type", "application/octet-stream");
            exchange.sendResponseHeaders(200, pcm.length - 1);
            exchange.getResponseBody().write(pcm, 0, pcm.length - 1);
        });
        AtomicLong bytes = new AtomicLong();
        AtomicReference<String> completed = new AtomicReference<>();

        try (StreamingTtsSession session = provider("test-key", "cloned-voice")
                .openStreamingSession(new StreamingTtsListener() {
                    @Override public void onAudio(byte[] audio) {
                        assertThat(audio.length).isEven();
                        bytes.addAndGet(audio.length);
                    }
                    @Override public void onSentence(String text) { completed.set(text); }
                })) {
            session.write("实时语音");
            session.finish();
        }

        assertThat(bytes.get()).isEqualTo(pcm.length - 1L);
        assertThat(completed.get()).isEqualTo("实时语音");
    }

    @Test void exposesUpstreamErrorWithoutLeakingTheApiKey() throws Exception {
        start(exchange -> {
            byte[] response = "{\"message\":\"insufficient credits\"}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(402, response.length);
            exchange.getResponseBody().write(response);
        });

        FishAudioTtsProvider provider = provider("secret-not-for-errors", "cloned-voice");
        assertThatThrownBy(() -> provider.synthesize("你好"))
                .isInstanceOf(TtsException.class)
                .hasMessageContaining("402")
                .hasMessageContaining("insufficient credits")
                .hasMessageNotContaining("secret-not-for-errors");
    }

    private FishAudioTtsProvider provider(String key, String referenceId) {
        String endpoint = "http://127.0.0.1:" + server.getAddress().getPort() + "/v1/tts";
        return new FishAudioTtsProvider(HttpClient.newHttpClient(), endpoint, key, referenceId,
                "s2-pro", 1.0, Duration.ofSeconds(5));
    }

    private void start(Handler handler) throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/tts", exchange -> {
            try { handler.handle(exchange); }
            catch (Exception e) { throw new java.io.IOException(e); }
            finally { exchange.close(); }
        });
        server.start();
    }

    @FunctionalInterface
    private interface Handler {
        void handle(com.sun.net.httpserver.HttpExchange exchange) throws Exception;
    }
}
