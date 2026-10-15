package org.xzzz.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.xzzz.entity.ChatHistory;
import org.xzzz.exception.ConversationNotFoundException;
import org.xzzz.mapper.ChatHistoryMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChatHistoryServiceOwnershipTest {

    private ChatHistoryMapper mapper;
    private ChatHistoryService service;

    @BeforeEach
    void setUp() {
        mapper = mock(ChatHistoryMapper.class);
        service = new ChatHistoryService(mapper);
    }

    @Test
    void savesMessageOnlyAfterConversationOwnershipIsConfirmed() {
        when(mapper.countOwnedConversation("session-1", "user-1")).thenReturn(1);

        service.save("user-1", "session-1", "user", "hello");

        verify(mapper).upsertConversation("session-1", "user-1", "hello");
        ArgumentCaptor<ChatHistory> message = ArgumentCaptor.forClass(ChatHistory.class);
        verify(mapper).insert(message.capture());
        assertThat(message.getValue().getUserId()).isEqualTo("user-1");
        assertThat(message.getValue().getSessionId()).isEqualTo("session-1");
        assertThat(message.getValue().getContent()).isEqualTo("hello");
    }

    @Test
    void rejectsAConversationOwnedByAnotherUserBeforeWritingMessage() {
        when(mapper.countOwnedConversation("shared-session", "attacker")).thenReturn(0);

        assertThatThrownBy(() -> service.save("attacker", "shared-session", "user", "probe"))
                .isInstanceOf(ConversationNotFoundException.class)
                .hasMessage("会话不存在");

        verify(mapper).upsertConversation("shared-session", "attacker", "probe");
        verify(mapper, never()).insert(org.mockito.ArgumentMatchers.any(ChatHistory.class));
    }
}
