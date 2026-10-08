package org.xzzz.entity.dto;

/**
 * 对话请求体。
 *
 * <p>改用 POST 之后 prompt 不再出现在 URL、访问日志和中间代理里，也不受 URL 长度限制。
 * 具体字段校验见 {@code XiLianChatService#validate}。
 */
public record ChatRequest(String userId, String conversationId, String prompt) {
}
