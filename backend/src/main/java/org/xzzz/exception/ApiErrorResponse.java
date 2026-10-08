package org.xzzz.exception;

import org.springframework.http.HttpStatus;

import java.time.Instant;

/**
 * 统一的错误响应体，替代原先「500 但 body 为空」的行为。
 */
public record ApiErrorResponse(
        Instant timestamp,
        int status,
        String error,
        String message,
        String path
) {
    public static ApiErrorResponse of(HttpStatus status, String message, String path) {
        return new ApiErrorResponse(
                Instant.now(),
                status.value(),
                status.getReasonPhrase(),
                message,
                path
        );
    }
}
