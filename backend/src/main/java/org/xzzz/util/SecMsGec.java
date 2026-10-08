package org.xzzz.util;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * Edge TTS 的 {@code Sec-MS-GEC} 鉴权令牌。
 *
 * <p>算法：把当前时间换成 Windows file time（1601-01-01 起算的 100ns tick 数），向下取整到
 * 5 分钟窗口，拼上 trusted client token 后取 SHA-256 的大写十六进制。缺少这个参数时微软会
 * 直接以 HTTP 403 拒绝握手。
 *
 * <p>单独抽出来是为了可测：{@link #generate(long)} 接收时间戳而不是自己取当前时间。
 */
public final class SecMsGec {

    /** 标识 Edge 朗读客户端的固定 token，也是哈希输入的一部分。 */
    public static final String TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

    /** 1601-01-01 到 1970-01-01 的秒数。 */
    private static final long WIN_EPOCH_OFFSET_SECONDS = 11_644_473_600L;

    /** 一个 Windows file time tick 是 100ns。 */
    private static final long TICKS_PER_SECOND = 10_000_000L;

    /** 令牌只在 5 分钟窗口内有效。 */
    private static final long WINDOW_SECONDS = 300L;

    private SecMsGec() {
    }

    /**
     * @param unixSeconds 已按服务器时钟校正过的 Unix 秒
     * @return 64 位大写十六进制 SHA-256
     */
    public static String generate(long unixSeconds) {
        long windows = Math.floorDiv(unixSeconds + WIN_EPOCH_OFFSET_SECONDS, WINDOW_SECONDS);
        long ticks = windows * WINDOW_SECONDS * TICKS_PER_SECOND;

        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest((ticks + TRUSTED_CLIENT_TOKEN).getBytes(StandardCharsets.US_ASCII));
            return HexFormat.of().withUpperCase().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available in this JVM", e);
        }
    }
}
