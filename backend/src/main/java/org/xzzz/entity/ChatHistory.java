package org.xzzz.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class ChatHistory {

    private Long id;
    private String userId;
    private String sessionId;
    private String role;
    private String content;
    private LocalDateTime createTime;

    public static ChatHistory of(String userId, String sessionId, String role, String content) {
        ChatHistory chatHistory = new ChatHistory();
        chatHistory.setUserId(userId);
        chatHistory.setSessionId(sessionId);
        chatHistory.setRole(role);
        chatHistory.setContent(content);
        chatHistory.setCreateTime(LocalDateTime.now());
        return chatHistory;
    }
}
