CREATE DATABASE IF NOT EXISTS spring_ai_test
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;

USE spring_ai_test;

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
