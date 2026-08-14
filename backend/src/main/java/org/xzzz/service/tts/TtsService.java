package org.xzzz.service.tts;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.TimeUnit;

@Slf4j
@Service
public class TtsService {

    private static final String WSS_URL =
            "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1" +
            "?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4";

    @Value("${tts.voice:zh-CN-XiaoxiaoNeural}")
    private String voiceName;

    @Value("${tts.rate:0}")
    private int rate;

    public byte[] synthesize(String text) throws Exception {
        if (text == null || text.isBlank()) {
            return new byte[0];
        }

        HttpClient httpClient = HttpClient.newHttpClient();
        ByteArrayOutputStream audioBuffer = new ByteArrayOutputStream();
        CompletableFuture<byte[]> resultFuture = new CompletableFuture<>();

        WebSocket ws = httpClient.newWebSocketBuilder()
                .header("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold")
                .header("User-Agent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0")
                .header("Accept-Encoding", "gzip, deflate, br")
                .header("Accept-Language", "en-US,en;q=0.9")
                .header("Cache-Control", "no-cache")
                .header("Pragma", "no-cache")
                .buildAsync(URI.create(WSS_URL), new TtsWebSocketListener(text, audioBuffer, resultFuture))
                .get(10, TimeUnit.SECONDS);

        return resultFuture.get(60, TimeUnit.SECONDS);
    }

    private class TtsWebSocketListener implements WebSocket.Listener {

        private final String text;
        private final ByteArrayOutputStream audioBuffer;
        private final CompletableFuture<byte[]> resultFuture;
        private boolean configSent;

        TtsWebSocketListener(String text, ByteArrayOutputStream audioBuffer,
                             CompletableFuture<byte[]> resultFuture) {
            this.text = text;
            this.audioBuffer = audioBuffer;
            this.resultFuture = resultFuture;
        }

        @Override
        public void onOpen(WebSocket webSocket) {
            log.debug("Edge TTS WebSocket connected, sending config...");
            sendConfigMessage(webSocket);
            webSocket.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            log.debug("Edge TTS text frame: {}", data);
            if (!configSent) {
                configSent = true;
                sendSsmlMessage(webSocket, text);
            }
            webSocket.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onBinary(WebSocket webSocket, ByteBuffer data, boolean last) {
            byte[] frameBytes = new byte[data.remaining()];
            data.get(frameBytes);

            int headerEnd = findHeaderEnd(frameBytes);
            if (headerEnd >= 0) {
                int audioStart = headerEnd + 4;
                if (audioStart < frameBytes.length) {
                    audioBuffer.write(frameBytes, audioStart, frameBytes.length - audioStart);
                }
            } else {
                audioBuffer.write(frameBytes, 0, frameBytes.length);
            }
            webSocket.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            log.debug("Edge TTS WebSocket closed: {} {}", statusCode, reason);
            resultFuture.complete(audioBuffer.toByteArray());
            return null;
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            log.error("Edge TTS WebSocket error", error);
            resultFuture.completeExceptionally(error);
        }
    }

    private void sendConfigMessage(WebSocket ws) {
        String requestId = uuid();
        String timestamp = nowTimestamp();
        String configJson = "{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":" +
                "{\"sentenceBoundaryEnabled\":false,\"wordBoundaryEnabled\":false}," +
                "\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}";

        String message = "Path: speech.config\r\n" +
                "X-RequestId: " + requestId + "\r\n" +
                "X-Timestamp: " + timestamp + "\r\n" +
                "Content-Type: application/json; charset=utf-8\r\n" +
                "\r\n" +
                configJson;

        ws.sendText(message, true);
    }

    private void sendSsmlMessage(WebSocket ws, String text) {
        String requestId = uuid();
        String timestamp = nowTimestamp();
        String escapedText = escapeXml(text);
        String rateAttr = rate != 0
                ? String.format(" rate=\"%+.0f%%\"", (double) rate * 100)
                : "";

        String ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>" +
                "<voice name='" + voiceName + "'" + rateAttr + ">" + escapedText + "</voice></speak>";

        String message = "Path: ssml\r\n" +
                "X-RequestId: " + requestId + "\r\n" +
                "X-Timestamp: " + timestamp + "\r\n" +
                "Content-Type: application/ssml+xml\r\n" +
                "\r\n" +
                ssml;

        ws.sendText(message, true);
    }

    private int findHeaderEnd(byte[] data) {
        for (int i = 0; i < data.length - 3; i++) {
            if (data[i] == '\r' && data[i + 1] == '\n'
                    && data[i + 2] == '\r' && data[i + 3] == '\n') {
                return i;
            }
        }
        return -1;
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

    private String nowTimestamp() {
        return String.valueOf(System.currentTimeMillis());
    }
}