package org.xzzz.util;


import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;
import org.xzzz.entity.ChatMessage;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.List;
import java.util.Objects;

@Component
@RequiredArgsConstructor
public class ChatRedisUtil {

    private static final String SESSION_KEY_PREFIX = "chat:session:";
    private static final Duration SESSION_TTL = Duration.ofDays(7);

    private final RedisTemplate<String, Object> redisTemplate;
    private final ObjectMapper objectMapper;

    public void appendMessage(String sessionId, ChatMessage message) {
        String key = buildKey(sessionId);
        redisTemplate.opsForList().rightPush(key, message);
        redisTemplate.expire(key, SESSION_TTL);
    }

    public List<ChatMessage> getHistory(String sessionId) {
        List<Object> messages = redisTemplate.opsForList().range(buildKey(sessionId), 0, -1);
        if (messages == null) {
            return List.of();
        }
        return messages.stream()
                .filter(Objects::nonNull)
                .map(message -> objectMapper.convertValue(message, ChatMessage.class))
                .toList();
    }

    public void clearSession(String sessionId) {
        redisTemplate.delete(buildKey(sessionId));
    }

    private String buildKey(String sessionId) {
        return SESSION_KEY_PREFIX + sessionId;
    }
}
