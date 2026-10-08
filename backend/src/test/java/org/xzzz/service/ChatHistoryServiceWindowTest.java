package org.xzzz.service;

import org.junit.jupiter.api.Test;
import org.xzzz.entity.ChatHistory;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ChatHistoryServiceWindowTest {

    private static ChatHistory message(String content) {
        ChatHistory chatHistory = new ChatHistory();
        chatHistory.setRole("user");
        chatHistory.setContent(content);
        return chatHistory;
    }

    @Test
    void returnsEmptyForEmptyOrNullInput() {
        assertThat(ChatHistoryService.trimToCharBudget(List.of(), 100)).isEmpty();
        assertThat(ChatHistoryService.trimToCharBudget(null, 100)).isEmpty();
    }

    @Test
    void keepsEverythingWhenWithinBudget() {
        List<ChatHistory> input = List.of(message("aa"), message("bb"));
        assertThat(ChatHistoryService.trimToCharBudget(input, 100)).hasSize(2);
    }

    @Test
    void dropsOldestFirstWhenOverBudget() {
        List<ChatHistory> input = List.of(
                message("a".repeat(10)),
                message("b".repeat(10)),
                message("c".repeat(10)));

        List<ChatHistory> result = ChatHistoryService.trimToCharBudget(input, 25);

        assertThat(result).hasSize(2);
        assertThat(result.get(0).getContent()).isEqualTo("b".repeat(10));
        assertThat(result.get(1).getContent()).isEqualTo("c".repeat(10));
    }

    @Test
    void alwaysKeepsTheLatestMessageEvenIfItAloneExceedsTheBudget() {
        List<ChatHistory> input = List.of(message("a".repeat(1000)), message("b".repeat(1000)));
        List<ChatHistory> result = ChatHistoryService.trimToCharBudget(input, 10);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getContent()).isEqualTo("b".repeat(1000));
    }

    @Test
    void toleratesNullContent() {
        List<ChatHistory> input = List.of(message(null), message("keep"));
        assertThat(ChatHistoryService.trimToCharBudget(input, 100)).hasSize(2);
    }
}
