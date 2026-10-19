package org.xzzz.exception;

/**
 * 阿里云百炼多模态接口（图像理解 / 语音识别）调用失败。
 */
public class ModelStudioException extends RuntimeException {

    public ModelStudioException(String message) {
        super(message);
    }

    public ModelStudioException(String message, Throwable cause) {
        super(message, cause);
    }
}
