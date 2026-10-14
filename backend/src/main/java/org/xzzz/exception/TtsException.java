package org.xzzz.exception;

/**
 * 语音合成失败（阿里云 Voice Studio 鉴权、网络或生成错误等）。
 *
 * <p>单独一个类型是为了让全局异常处理器返回 502「上游不可用」，而不是笼统的 500。
 */
public class TtsException extends RuntimeException {

    public TtsException(String message) {
        super(message);
    }

    public TtsException(String message, Throwable cause) {
        super(message, cause);
    }
}
