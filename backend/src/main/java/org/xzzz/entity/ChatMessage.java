package org.xzzz.entity;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ChatMessage {

    private String role;
    private String content;
    private LocalDateTime createTime;

    public static ChatMessage of(String role, String content) {
        return new ChatMessage(role, content, LocalDateTime.now());
    }
}
