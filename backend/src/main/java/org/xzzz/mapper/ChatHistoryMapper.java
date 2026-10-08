package org.xzzz.mapper;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import org.xzzz.entity.ChatHistory;
import org.xzzz.entity.vo.ConversationVo;

import java.util.List;

@Mapper
public interface ChatHistoryMapper {

    @Insert("""
            INSERT INTO chat_history (user_id, session_id, role, content, create_time)
            VALUES (#{userId}, #{sessionId}, #{role}, #{content}, #{createTime})
            """)
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(ChatHistory chatHistory);

    /**
     * 按时间顺序读取一个会话的全部消息，用于前端回显。
     */
    @Select("""
            SELECT id, user_id, session_id, role, content, create_time
            FROM chat_history
            WHERE session_id = #{sessionId}
            ORDER BY id ASC
            """)
    List<ChatHistory> selectBySessionId(@Param("sessionId") String sessionId);

    /**
     * 只取最近 {@code limit} 条消息（按时间正序返回），用于拼装大模型上下文。
     *
     * <p>先倒序取 N 条再翻转，避免把整个会话都读进内存。
     */
    @Select("""
            SELECT recent.id, recent.user_id, recent.session_id, recent.role, recent.content, recent.create_time
            FROM (
                SELECT id, user_id, session_id, role, content, create_time
                FROM chat_history
                WHERE session_id = #{sessionId}
                ORDER BY id DESC
                LIMIT #{limit}
            ) recent
            ORDER BY recent.id ASC
            """)
    List<ChatHistory> selectRecentBySessionId(@Param("sessionId") String sessionId,
                                              @Param("limit") int limit);

    /**
     * 确保会话存在：不存在则用 {@code title} 建一条，已存在则只刷新 {@code updated_at}（保留原标题）。
     */
    @Insert("""
            INSERT INTO conversation (id, user_id, title, created_at, updated_at)
            VALUES (#{sessionId}, #{userId}, #{title}, NOW(), NOW())
            ON DUPLICATE KEY UPDATE updated_at = NOW()
            """)
    int upsertConversation(@Param("sessionId") String sessionId,
                           @Param("userId") String userId,
                           @Param("title") String title);

    /**
     * 会话列表，直接读元数据表，不再对消息表做相关子查询。
     */
    @Select("""
            SELECT c.id    AS sessionId,
                   c.title AS title,
                   c.updated_at AS lastTime,
                   (SELECT COUNT(*) FROM chat_history h WHERE h.session_id = c.id) AS messageCount
              FROM conversation c
             WHERE c.user_id = #{userId}
             ORDER BY c.updated_at DESC
            """)
    List<ConversationVo> selectConversations(@Param("userId") String userId);

    /**
     * 判断会话是否属于该用户，用于数据隔离。
     */
    @Select("""
            SELECT COUNT(*)
            FROM conversation
            WHERE id = #{sessionId} AND user_id = #{userId}
            """)
    int countOwnedConversation(@Param("sessionId") String sessionId,
                               @Param("userId") String userId);

    @Update("""
            UPDATE conversation
               SET title = #{title}
             WHERE id = #{sessionId} AND user_id = #{userId}
            """)
    int renameConversation(@Param("sessionId") String sessionId,
                           @Param("userId") String userId,
                           @Param("title") String title);

    @Delete("DELETE FROM conversation WHERE id = #{sessionId} AND user_id = #{userId}")
    int deleteConversation(@Param("sessionId") String sessionId,
                           @Param("userId") String userId);

    @Delete("DELETE FROM chat_history WHERE session_id = #{sessionId}")
    int deleteMessagesBySessionId(@Param("sessionId") String sessionId);
}
