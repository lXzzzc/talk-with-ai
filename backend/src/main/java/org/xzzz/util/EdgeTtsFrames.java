package org.xzzz.util;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * Edge TTS WebSocket 二进制帧的解析。
 *
 * <p>帧结构是：<b>2 字节大端 header 长度 + header 文本 + 音频负载</b>。
 * header 里<b>没有空行结尾</b>（形如 {@code Path:audio\r\nX-RequestId:...\r\nContent-Type:audio/mpeg\r\n}），
 * 所以只能靠长度前缀定位音频起点；早期版本用「查找 \r\n\r\n」的做法永远找不到，会把 2 字节长度前缀
 * 和整个 header 当成音频拼进 MP3 里。
 */
public final class EdgeTtsFrames {

    private static final String AUDIO_PATH_MARKER = "Path:audio";

    private EdgeTtsFrames() {
    }

    /**
     * 取出帧里的音频负载。
     *
     * @return 音频字节；不是音频帧或帧不完整时返回空数组
     */
    public static byte[] extractAudio(byte[] frame) {
        if (frame == null || frame.length < 2) {
            return new byte[0];
        }

        int headerLength = ((frame[0] & 0xFF) << 8) | (frame[1] & 0xFF);
        int audioStart = headerLength + 2;
        if (audioStart >= frame.length) {
            return new byte[0];
        }

        String header = new String(frame, 2, headerLength, StandardCharsets.US_ASCII);
        if (!header.contains(AUDIO_PATH_MARKER)) {
            return new byte[0];
        }

        return Arrays.copyOfRange(frame, audioStart, frame.length);
    }

    /**
     * 读取帧头文本，仅用于排查问题。
     */
    public static String headerOf(byte[] frame) {
        if (frame == null || frame.length < 2) {
            return "";
        }
        int headerLength = ((frame[0] & 0xFF) << 8) | (frame[1] & 0xFF);
        if (headerLength + 2 > frame.length) {
            return "";
        }
        return new String(frame, 2, headerLength, StandardCharsets.US_ASCII);
    }
}
