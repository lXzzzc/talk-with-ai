package org.xzzz.exception;

/** 第三方天气服务不可用或返回了无法解析的数据。 */
public class WeatherException extends RuntimeException {

    public WeatherException(String message) {
        super(message);
    }

    public WeatherException(String message, Throwable cause) {
        super(message, cause);
    }
}
