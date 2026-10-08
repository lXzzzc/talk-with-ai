package org.xzzz.entity.vo;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 会话列表项。由 chat_history 聚合而成，供前端左侧「历史记录」使用。
 */
@Data
public class ConversationVo {

    /** 会话 id，对应 chat_history.session_id */
    private String sessionId;

    /** 会话标题：取该会话第一条 user 消息的前 30 个字符 */
    private String title;

    /** 该会话最后一条消息的时间 */
    private LocalDateTime lastTime;

    /** 该会话的消息条数 */
    private Integer messageCount;
}
