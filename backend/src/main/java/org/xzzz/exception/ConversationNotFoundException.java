package org.xzzz.exception;

/**
 * 会话不存在或不属于当前用户。两种情况使用相同响应，避免泄露会话是否真实存在。
 */
public class ConversationNotFoundException extends RuntimeException {

    public ConversationNotFoundException() {
        super("会话不存在");
    }
}
