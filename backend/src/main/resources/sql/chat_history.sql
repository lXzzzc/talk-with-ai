-- 只负责创建数据库。表结构由 Flyway 管理（见 src/main/resources/db/migration/）。
--
-- 用法：
--   mysql -u root -p < backend/src/main/resources/sql/chat_history.sql
--
-- 应用启动时 Flyway 会自动建表并回填已有数据，因此不需要再手工执行建表语句。
CREATE DATABASE IF NOT EXISTS spring_ai_test
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;
