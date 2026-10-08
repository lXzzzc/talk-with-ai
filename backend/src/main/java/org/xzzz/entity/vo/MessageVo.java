package org.xzzz.entity.vo;

import lombok.Data;
import lombok.NoArgsConstructor;
import org.xzzz.entity.ChatHistory;

@NoArgsConstructor
@Data
public class MessageVo {
    private String role;
    private String content;

    public MessageVo(ChatHistory chatHistory) {
        this.role = chatHistory.getRole();
        this.content = chatHistory.getContent();
    }
}
