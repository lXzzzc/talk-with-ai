package org.xzzz.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Options;
import org.xzzz.entity.ChatHistory;

@Mapper
public interface ChatHistoryMapper {

    @Insert("""
            INSERT INTO chat_history (user_id, session_id, role, content, create_time)
            VALUES (#{userId}, #{sessionId}, #{role}, #{content}, #{createTime})
            """)
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(ChatHistory chatHistory);
}
