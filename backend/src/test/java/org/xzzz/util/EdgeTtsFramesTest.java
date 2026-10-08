package org.xzzz.util;

import org.junit.jupiter.api.Test;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 覆盖曾经真实出过的 bug：旧实现用「查找 \r\n\r\n」定位音频起点，而 header 里根本没有空行结尾，
 * 结果把 2 字节长度前缀和整段 header 都当成音频写进了 MP3。
 */
class EdgeTtsFramesTest {

    private static final byte[] MP3_PAYLOAD = {(byte) 0xFF, (byte) 0xF3, 0x64, (byte) 0xC4, 0x00, 0x00};

    private static byte[] frameOf(String header) {
        byte[] headerBytes = header.getBytes(StandardCharsets.US_ASCII);
        return ByteBuffer.allocate(2 + headerBytes.length + MP3_PAYLOAD.length)
                .putShort((short) headerBytes.length)
                .put(headerBytes)
                .put(MP3_PAYLOAD)
                .array();
    }

    @Test
    void extractsOnlyTheAudioPayload() {
        byte[] frame = frameOf("Path:audio\r\nX-RequestId:abc\r\nContent-Type:audio/mpeg\r\n");
        assertThat(EdgeTtsFrames.extractAudio(frame)).containsExactly(MP3_PAYLOAD);
    }

    @Test
    void audioFrameHeaderHasNoBlankLineTerminator() {
        // 这正是旧实现失效的原因：header 以单个 \r\n 结束，不存在 \r\n\r\n
        String header = "Path:audio\r\nX-RequestId:abc\r\nContent-Type:audio/mpeg\r\n";
        assertThat(header).doesNotContain("\r\n\r\n");
    }

    @Test
    void skipsBinaryFramesThatAreNotAudio() {
        byte[] frame = frameOf("Path:response\r\nContent-Type:application/json\r\n");
        assertThat(EdgeTtsFrames.extractAudio(frame)).isEmpty();
    }

    @Test
    void returnsEmptyForTruncatedOrEmptyFrames() {
        assertThat(EdgeTtsFrames.extractAudio(new byte[0])).isEmpty();
        assertThat(EdgeTtsFrames.extractAudio(new byte[]{0x00})).isEmpty();
        // 声称 header 有 128 字节，但整个帧只有 2 字节
        assertThat(EdgeTtsFrames.extractAudio(new byte[]{0x00, (byte) 0x80})).isEmpty();
    }

    @Test
    void returnsEmptyWhenHeaderConsumesTheWholeFrame() {
        byte[] header = "Path:audio\r\n".getBytes(StandardCharsets.US_ASCII);
        byte[] frame = ByteBuffer.allocate(2 + header.length)
                .putShort((short) header.length)
                .put(header)
                .array();
        assertThat(EdgeTtsFrames.extractAudio(frame)).isEmpty();
    }

    @Test
    void exposesHeaderForDiagnostics() {
        String header = "Path:audio\r\nX-RequestId:abc\r\n";
        assertThat(EdgeTtsFrames.headerOf(frameOf(header))).isEqualTo(header);
    }
}
