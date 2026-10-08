-- 会话元数据表。
-- 之前会话标题是每次查询时用相关子查询从消息里现算的，既慢又没法重命名；
-- 这里把会话的标题/时间独立成表，并回填已有数据。
CREATE TABLE IF NOT EXISTS conversation (
    id         VARCHAR(128) PRIMARY KEY COMMENT 'session id',
    user_id    VARCHAR(64)  NOT NULL COMMENT 'owner user id',
    title      VARCHAR(200) NOT NULL COMMENT 'conversation title',
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'create time',
    updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'last update time',
    INDEX idx_conversation_user_updated (user_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='conversation metadata';

-- 回填历史会话：标题取该会话第一条 user 消息的前 30 个字符。
INSERT INTO conversation (id, user_id, title, created_at, updated_at)
SELECT c.session_id,
       MIN(c.user_id),
       COALESCE(
           (SELECT LEFT(c2.content, 30)
              FROM chat_history c2
             WHERE c2.session_id = c.session_id
               AND c2.role = 'user'
             ORDER BY c2.id ASC
             LIMIT 1),
           c.session_id),
       MIN(c.create_time),
       MAX(c.create_time)
  FROM chat_history c
 GROUP BY c.session_id
ON DUPLICATE KEY UPDATE conversation.updated_at = conversation.updated_at;
