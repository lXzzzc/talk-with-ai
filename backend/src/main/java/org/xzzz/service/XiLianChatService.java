package org.xzzz.service;

import lombok.RequiredArgsConstructor;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.xzzz.entity.ChatHistory;
import reactor.core.publisher.Flux;

import java.util.List;

@Service
@RequiredArgsConstructor
public class XiLianChatService {

    /** 与 chat_history.user_id / session_id 的列宽保持一致，避免写库时才报 data too long。 */
    private static final int MAX_USER_ID_LENGTH = 64;
    private static final int MAX_SESSION_ID_LENGTH = 128;

    private final ChatClient chatClient;
    private final ChatHistoryService chatHistoryService;
    private final ChatHistoryAsyncService chatHistoryAsyncService;

    @Value("${chat.request.max-prompt-chars:4000}")
    private int maxPromptChars;

    public Flux<String> chat(String userId, String sessionId, String prompt) {
        validate(userId, sessionId, prompt);

        // 先把用户消息同步落库：它既要马上参与下面的上下文拼装，也是 MySQL 作为唯一事实来源的前提。
        chatHistoryService.save(userId, sessionId, "user", prompt);

        // 上下文统一从 MySQL 读取（只取最近若干条，见 getContextMessages），因此跨进程重启后对话依然连续。
        List<Message> historyMessages = chatHistoryService.getContextMessages(sessionId).stream()
                .map(XiLianChatService::toSpringAiMessage)
                .toList();

        StringBuilder assistantContent = new StringBuilder();

        return chatClient.prompt()
                .messages(historyMessages)
                .stream()
                .content()
                .doOnNext(assistantContent::append)
                .doOnComplete(() -> saveAssistantMessage(userId, sessionId, assistantContent.toString()));
    }

    /**
     * 入参校验。抛出 {@link IllegalArgumentException}，由 GlobalExceptionHandler 统一转成 400。
     */
    private void validate(String userId, String sessionId, String prompt) {
        if (prompt == null || prompt.isBlank()) {
            throw new IllegalArgumentException("prompt 不能为空");
        }
        if (prompt.length() > maxPromptChars) {
            throw new IllegalArgumentException("prompt 长度不能超过 " + maxPromptChars + " 个字符");
        }
        if (userId == null || userId.isBlank()) {
            throw new IllegalArgumentException("userId 不能为空");
        }
        if (userId.length() > MAX_USER_ID_LENGTH) {
            throw new IllegalArgumentException("userId 长度不能超过 " + MAX_USER_ID_LENGTH + " 个字符");
        }
        if (sessionId == null || sessionId.isBlank()) {
            throw new IllegalArgumentException("conversationId 不能为空");
        }
        if (sessionId.length() > MAX_SESSION_ID_LENGTH) {
            throw new IllegalArgumentException("conversationId 长度不能超过 " + MAX_SESSION_ID_LENGTH + " 个字符");
        }
    }

    private static Message toSpringAiMessage(ChatHistory chatHistory) {
        if ("assistant".equals(chatHistory.getRole())) {
            return new AssistantMessage(chatHistory.getContent());
        }
        return new UserMessage(chatHistory.getContent());
    }

    private void saveAssistantMessage(String userId, String sessionId, String content) {
        if (content == null || content.isBlank()) {
            return;
        }
        chatHistoryAsyncService.saveAsync(userId, sessionId, "assistant", content);
    }
}
