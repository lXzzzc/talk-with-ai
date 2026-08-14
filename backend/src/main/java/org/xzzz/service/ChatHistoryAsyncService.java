package org.xzzz.service;

import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.xzzz.entity.ChatHistory;
import org.xzzz.mapper.ChatHistoryMapper;

@Service
@RequiredArgsConstructor
public class ChatHistoryAsyncService {

    private final ChatHistoryMapper chatHistoryMapper;

    @Async
    public void saveAsync(String userId, String sessionId, String role, String content) {
        chatHistoryMapper.insert(ChatHistory.of(userId, sessionId, role, content));
    }
}
