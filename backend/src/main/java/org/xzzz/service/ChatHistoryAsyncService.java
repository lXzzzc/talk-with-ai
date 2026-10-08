package org.xzzz.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/**
 * 助手回复的异步落库。
 *
 * <p>写入逻辑复用 {@link ChatHistoryService}，避免同步/异步两条路径各写一份。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ChatHistoryAsyncService {

    private final ChatHistoryService chatHistoryService;

    /**
     * 使用 {@code chatHistoryExecutor} 线程池（见 AsyncConfiguration），
     * 而不是默认的 SimpleAsyncTaskExecutor。
     */
    @Async("chatHistoryExecutor")
    public void saveAsync(String userId, String sessionId, String role, String content) {
        try {
            chatHistoryService.save(userId, sessionId, role, content);
        } catch (Exception e) {
            // 异步线程里的异常不会传到调用方，必须显式记日志，否则消息会静默丢失
            log.error("异步保存聊天记录失败 sessionId={} role={}", sessionId, role, e);
        }
    }
}
