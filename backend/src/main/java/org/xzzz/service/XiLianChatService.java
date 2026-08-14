package org.xzzz.service;

import lombok.RequiredArgsConstructor;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.stereotype.Service;
import org.xzzz.entity.ChatMessage;
import org.xzzz.util.ChatRedisUtil;
import reactor.core.publisher.Flux;

import java.util.List;

@Service
@RequiredArgsConstructor
public class XiLianChatService {

    private final ChatClient chatClient;
    private final ChatRedisUtil chatRedisUtil;
    private final ChatHistoryAsyncService chatHistoryAsyncService;

    public Flux<String> chat(String userId, String sessionId, String prompt) {
        ChatMessage userMessage = ChatMessage.of("user", prompt);
        chatRedisUtil.appendMessage(sessionId, userMessage);
        chatHistoryAsyncService.saveAsync(userId, sessionId, "user", prompt);

        List<Message> historyMessages = chatRedisUtil.getHistory(sessionId).stream()
                .map(this::toSpringAiMessage)
                .toList();
        StringBuilder assistantContent = new StringBuilder();

        return chatClient.prompt()
                .messages(historyMessages)
                .advisors(advisor -> advisor.param(ChatMemory.CONVERSATION_ID, sessionId))
                .stream()
                .content()
                .doOnNext(assistantContent::append)
                .doOnComplete(() -> saveAssistantMessage(userId, sessionId, assistantContent.toString()));
    }

    private Message toSpringAiMessage(ChatMessage message) {
        if ("assistant".equals(message.getRole())) {
            return new AssistantMessage(message.getContent());
        }
        return new UserMessage(message.getContent());
    }

    private void saveAssistantMessage(String userId, String sessionId, String content) {
        if (content == null || content.isBlank()) {
            return;
        }
        chatRedisUtil.appendMessage(sessionId, ChatMessage.of("assistant", content));
        chatHistoryAsyncService.saveAsync(userId, sessionId, "assistant", content);
    }
}
