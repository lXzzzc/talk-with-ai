package org.xzzz.service.tts;

import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.xzzz.util.AudioCache;
import org.xzzz.util.EdgeTtsFrames;
import org.xzzz.util.SecMsGec;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.net.http.WebSocketHandshakeException;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

/**
 * Synthesizes speech through the Microsoft Edge "read aloud" WebSocket service.
 *
 * <p>The service authenticates every handshake with a {@code Sec-MS-GEC} query parameter: an
 * uppercase SHA-256 of the current Windows file time (rounded down to a 5 minute window, expressed
 * in 100 ns ticks) concatenated with the trusted client token. Omitting it makes the service reject
 * the handshake with HTTP 403.
 */
@Slf4j
@Service
public class TtsService {

    /** Token that identifies the Edge read-aloud client; part of the Sec-MS-GEC hash input. */
    private static final String TRUSTED_CLIENT_TOKEN = SecMsGec.TRUSTED_CLIENT_TOKEN;

    private static final String WSS_ENDPOINT =
            "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

    /** Chromium version the request masquerades as; also used for the Sec-MS-GEC-Version parameter. */
    private static final String CHROMIUM_FULL_VERSION = "143.0.3650.75";

    private static final String CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.substring(
            0, CHROMIUM_FULL_VERSION.indexOf('.'));

    private static final String SEC_MS_GEC_VERSION = "1-" + CHROMIUM_FULL_VERSION;

    private static final String OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

    /** Seconds between the Windows file-time epoch (1601-01-01) and the Unix epoch (1970-01-01). */
    private static final long CONNECT_TIMEOUT_SECONDS = 10L;
    private static final long HANDSHAKE_TIMEOUT_SECONDS = 10L;
    private static final long SYNTHESIS_TIMEOUT_SECONDS = 60L;

    private static final DateTimeFormatter EDGE_TIMESTAMP_FORMAT = DateTimeFormatter.ofPattern(
            "EEE MMM dd yyyy HH:mm:ss 'GMT+0000 (Coordinated Universal Time)'", Locale.US);

    /**
     * One client for the whole application. An {@link HttpClient} owns a selector thread and an
     * executor, so creating one per request leaked threads until the JVM exited.
     */
    private final HttpClient httpClient = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(CONNECT_TIMEOUT_SECONDS))
            .build();

    private final AudioCache audioCache;

    public TtsService(AudioCache audioCache) {
        this.audioCache = audioCache;
    }

    @Value("${tts.voice:zh-CN-XiaoxiaoNeural}")
    private String voiceName;

    @Value("${tts.rate:0}")
    private int rate;

    /** Seconds the local clock differs from the TTS server, learned from a rejected handshake. */
    private volatile long clockSkewSeconds;

    @PreDestroy
    public void shutdown() {
        httpClient.shutdownNow();
    }

    /**
     * Synthesizes {@code text} into MP3 audio.
     *
     * @param text plain text to speak; XML special characters are escaped before it is sent
     * @return MP3 bytes, never empty
     */
    public byte[] synthesize(String text) throws Exception {
        if (text == null || text.isBlank()) {
            return new byte[0];
        }

        // 同一音色 + 语速 + 文本的合成结果可以复用；前端分句朗读时重复句子很常见。
        String cacheKey = voiceName + '\u0000' + rate + '\u0000' + text;
        byte[] cached = audioCache.get(cacheKey);
        if (cached != null) {
            log.debug("Edge TTS cache hit, {} bytes", cached.length);
            return cached;
        }

        byte[] audio = synthesizeUncached(text);
        audioCache.put(cacheKey, audio);
        return audio;
    }

    private byte[] synthesizeUncached(String text) throws Exception {
        try {
            return synthesizeOnce(text);
        } catch (ExecutionException e) {
            // A 403 during the handshake almost always means the machine clock (and therefore the
            // Sec-MS-GEC token) is out of sync. Correct it from the server Date header and retry once.
            if (e.getCause() instanceof WebSocketHandshakeException handshake && adjustClockSkew(handshake)) {
                log.warn("Edge TTS handshake rejected, retrying with corrected clock skew of {}s",
                        clockSkewSeconds);
                return synthesizeOnce(text);
            }
            throw e;
        }
    }

    private byte[] synthesizeOnce(String text) throws Exception {
        ByteArrayOutputStream audioBuffer = new ByteArrayOutputStream();
        CompletableFuture<byte[]> resultFuture = new CompletableFuture<>();
        WebSocket webSocket = null;
        try {
            webSocket = httpClient.newWebSocketBuilder()
                    .connectTimeout(Duration.ofSeconds(CONNECT_TIMEOUT_SECONDS))
                    .header("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold")
                    .header("User-Agent", userAgent())
                    .header("Accept-Encoding", "gzip, deflate, br")
                    .header("Accept-Language", "en-US,en;q=0.9")
                    .header("Cache-Control", "no-cache")
                    .header("Pragma", "no-cache")
                    .buildAsync(buildUri(), new TtsWebSocketListener(text, audioBuffer, resultFuture))
                    .get(HANDSHAKE_TIMEOUT_SECONDS, TimeUnit.SECONDS);

            byte[] audio = resultFuture.get(SYNTHESIS_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            if (audio.length == 0) {
                throw new IllegalStateException("Edge TTS returned no audio for the requested text");
            }
            return audio;
        } finally {
            // Releases the connection when the synthesis timed out or failed.
            if (webSocket != null && !webSocket.isOutputClosed()) {
                webSocket.abort();
            }
        }
    }

    private URI buildUri() {
        return URI.create(WSS_ENDPOINT
                + "?TrustedClientToken=" + TRUSTED_CLIENT_TOKEN
                + "&Sec-MS-GEC=" + generateSecMsGec()
                + "&Sec-MS-GEC-Version=" + SEC_MS_GEC_VERSION);
    }

    /**
     * Builds the {@code Sec-MS-GEC} token: {@code SHA256(ticks + TRUSTED_CLIENT_TOKEN)} in uppercase
     * hex, where {@code ticks} is the current time as Windows file time in 100 ns units, truncated to
     * a 5 minute boundary.
     */
    private String generateSecMsGec() {
        return SecMsGec.generate(Instant.now().getEpochSecond() + clockSkewSeconds);
    }

    /**
     * Aligns the clock with the server using the {@code Date} header of a rejected handshake.
     *
     * @return {@code true} when a retry with the corrected clock may succeed
     */
    private boolean adjustClockSkew(WebSocketHandshakeException handshake) {
        if (handshake.getResponse() == null) {
            return false;
        }
        Optional<String> serverDate = handshake.getResponse().headers().firstValue("date");
        if (serverDate.isEmpty()) {
            return false;
        }
        try {
            long serverEpochSeconds = ZonedDateTime
                    .parse(serverDate.get(), DateTimeFormatter.RFC_1123_DATE_TIME)
                    .toEpochSecond();
            long skewSeconds = serverEpochSeconds - Instant.now().getEpochSecond();
            if (Math.abs(skewSeconds) < 2) {
                return false;
            }
            clockSkewSeconds += skewSeconds;
            return true;
        } catch (DateTimeParseException e) {
            log.warn("Unable to parse Edge TTS server date '{}'", serverDate.get());
            return false;
        }
    }

    private class TtsWebSocketListener implements WebSocket.Listener {

        private final String text;
        private final ByteArrayOutputStream audioBuffer;
        private final CompletableFuture<byte[]> resultFuture;
        /** Accumulates a binary message that the JDK delivers across several callbacks. */
        private final ByteArrayOutputStream binaryMessage = new ByteArrayOutputStream();
        /** Accumulates a text message that the JDK delivers across several callbacks. */
        private final StringBuilder textMessage = new StringBuilder();

        TtsWebSocketListener(String text, ByteArrayOutputStream audioBuffer,
                             CompletableFuture<byte[]> resultFuture) {
            this.text = text;
            this.audioBuffer = audioBuffer;
            this.resultFuture = resultFuture;
        }

        @Override
        public void onOpen(WebSocket webSocket) {
            log.debug("Edge TTS WebSocket connected, sending config and ssml...");
            sendConfigMessage(webSocket);
            sendSsmlMessage(webSocket, text);
            webSocket.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            textMessage.append(data);
            if (!last) {
                webSocket.request(1);
                return null;
            }
            String payload = textMessage.toString();
            textMessage.setLength(0);

            if (payload.contains("Path:turn.end")) {
                // Every audio frame of this turn has already been buffered, so the result is complete.
                resultFuture.complete(audioBuffer.toByteArray());
                webSocket.sendClose(WebSocket.NORMAL_CLOSURE, "done");
                return null;
            }
            log.debug("Edge TTS text frame: {}", payload);
            webSocket.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onBinary(WebSocket webSocket, ByteBuffer data, boolean last) {
            byte[] chunk = new byte[data.remaining()];
            data.get(chunk);
            binaryMessage.write(chunk, 0, chunk.length);

            if (!last) {
                webSocket.request(1);
                return null;
            }
            byte[] frame = binaryMessage.toByteArray();
            binaryMessage.reset();
            appendAudio(frame);

            webSocket.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            log.debug("Edge TTS WebSocket closed: {} {}", statusCode, reason);
            // Covers connections that end without an explicit turn.end frame.
            resultFuture.complete(audioBuffer.toByteArray());
            return null;
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            log.error("Edge TTS WebSocket error", error);
            resultFuture.completeExceptionally(error);
        }

        /**
         * Strips the header from a binary frame and appends its payload to the audio buffer.
         *
         * <p>A binary frame is laid out as a 2 byte big-endian header length, the header text and then
         * the payload. The header has no blank line terminator, so the length prefix is the only
         * reliable way to locate the first audio byte; scanning for {@code \r\n\r\n} would fail and
         * splice the length prefix and the whole header into the MP3.
         */
        private void appendAudio(byte[] frame) {
            byte[] audio = EdgeTtsFrames.extractAudio(frame);
            if (audio.length == 0) {
                log.debug("Skipping non-audio binary frame: {}",
                        EdgeTtsFrames.headerOf(frame).replace("\r\n", " "));
                return;
            }
            audioBuffer.write(audio, 0, audio.length);
        }
    }

    private void sendConfigMessage(WebSocket ws) {
        String configJson = "{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":" +
                "{\"sentenceBoundaryEnabled\":false,\"wordBoundaryEnabled\":false}," +
                "\"outputFormat\":\"" + OUTPUT_FORMAT + "\"}}}}";

        ws.sendText(requestMessage("speech.config", "application/json; charset=utf-8", configJson), true);
    }

    private void sendSsmlMessage(WebSocket ws, String text) {
        String rateAttribute = rate != 0
                ? String.format(Locale.ROOT, " rate=\"%+d%%\"", (long) rate * 100)
                : "";

        String ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='"
                + resolveLanguage() + "'>"
                + "<voice name='" + voiceName + "'" + rateAttribute + ">"
                + escapeXml(text)
                + "</voice></speak>";

        ws.sendText(requestMessage("ssml", "application/ssml+xml", ssml), true);
    }

    /** Frames a request the way the Edge read-aloud protocol expects: headers, blank line, body. */
    private String requestMessage(String path, String contentType, String body) {
        return "Path: " + path + "\r\n" +
                "X-RequestId: " + uuid() + "\r\n" +
                "X-Timestamp: " + EDGE_TIMESTAMP_FORMAT.format(ZonedDateTime.now(ZoneOffset.UTC)) + "\r\n" +
                "Content-Type: " + contentType + "\r\n" +
                "\r\n" +
                body;
    }

    /** Derives the SSML language tag from the configured voice, e.g. {@code zh-CN-XiaoxiaoNeural}. */
    private String resolveLanguage() {
        String[] parts = voiceName == null ? new String[0] : voiceName.split("-");
        return parts.length >= 2 ? parts[0] + "-" + parts[1] : "en-US";
    }

    private String userAgent() {
        return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/" + CHROMIUM_MAJOR_VERSION + ".0.0.0 Safari/537.36 " +
                "Edg/" + CHROMIUM_MAJOR_VERSION + ".0.0.0";
    }

    private String escapeXml(String text) {
        return text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&apos;");
    }

    private String uuid() {
        return UUID.randomUUID().toString().replace("-", "");
    }
}
