package org.xzzz.exception;

import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/**
 * 全局异常处理，保证任何错误都返回统一的 JSON 结构，而不是空 body。
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler({
            IllegalArgumentException.class,
            MethodArgumentTypeMismatchException.class,
            MissingServletRequestParameterException.class
    })
    public ResponseEntity<ApiErrorResponse> handleBadRequest(Exception e, HttpServletRequest request) {
        return build(HttpStatus.BAD_REQUEST, e.getMessage(), request);
    }

    /** {@code @Valid} 校验失败，返回具体是哪个字段不合法。 */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiErrorResponse> handleValidation(MethodArgumentNotValidException e,
                                                             HttpServletRequest request) {
        String message = e.getBindingResult().getFieldErrors().stream()
                .map(error -> error.getField() + " " + error.getDefaultMessage())
                .findFirst()
                .orElse("参数校验失败");
        return build(HttpStatus.BAD_REQUEST, message, request);
    }

    /** 本地 TTS 服务（IndexTTS）不可用，网关类错误。 */
    @ExceptionHandler(TtsException.class)
    public ResponseEntity<ApiErrorResponse> handleTts(TtsException e, HttpServletRequest request) {
        log.warn("语音合成失败 {}: {}", request.getRequestURI(), e.getMessage());
        return build(HttpStatus.BAD_GATEWAY, e.getMessage(), request);
    }

    /** 请求体不是合法 JSON。原始异常信息很长，这里给一句干净的提示。 */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiErrorResponse> handleUnreadableBody(HttpMessageNotReadableException e,
                                                                 HttpServletRequest request) {
        return build(HttpStatus.BAD_REQUEST, "请求体不是合法的 JSON", request);
    }

    /**
     * 兜底处理。
     *
     * <p>注意必须把 Spring 自己的异常（404、405、406 等，都实现了 {@link ErrorResponse}）原样抛回去，
     * 否则会把「找不到资源」这类正常状态码统统变成 500。
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorResponse> handleUnexpected(Exception e,
                                                             HttpServletRequest request) throws Exception {
        if (e instanceof ErrorResponse) {
            throw e;
        }
        log.error("未处理异常 {} {}", request.getMethod(), request.getRequestURI(), e);
        return build(HttpStatus.INTERNAL_SERVER_ERROR, "服务器内部错误，请查看服务端日志", request);
    }

    private ResponseEntity<ApiErrorResponse> build(HttpStatus status, String message,
                                                   HttpServletRequest request) {
        String detail = (message == null || message.isBlank()) ? status.getReasonPhrase() : message;
        return ResponseEntity.status(status)
                .body(ApiErrorResponse.of(status, detail, request.getRequestURI()));
    }
}
