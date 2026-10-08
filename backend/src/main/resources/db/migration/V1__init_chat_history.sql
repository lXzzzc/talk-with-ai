-- 聊天记录表。
-- 说明：这个表最初由手工执行 sql/chat_history.sql 创建；引入 Flyway 之后由本脚本接管，
-- 使用 IF NOT EXISTS 以保证对已有数据库是幂等的。
CREATE TABLE IF NOT EXISTS chat_history (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT 'primary key',
    user_id VARCHAR(64) NOT NULL COMMENT 'user id',
    session_id VARCHAR(128) NOT NULL COMMENT 'session id',
    role VARCHAR(32) NOT NULL COMMENT 'message role: user/assistant',
    content LONGTEXT NOT NULL COMMENT 'message content',
    create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'create time',
    INDEX idx_chat_history_session_id (session_id),
    INDEX idx_chat_history_user_id (user_id),
    INDEX idx_chat_history_create_time (create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='chat history';
