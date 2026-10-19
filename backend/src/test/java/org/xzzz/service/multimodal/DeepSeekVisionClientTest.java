package org.xzzz.service.multimodal;

import org.junit.jupiter.api.Test;
import org.xzzz.exception.ModelStudioException;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class DeepSeekVisionClientTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void resolvesOpenAiCompatibleChatUrl() {
        assertEquals("https://api.deepseek.com/chat/completions",
                DeepSeekVisionClient.resolveChatUrl("https://api.deepseek.com/"));
        assertEquals("https://example.com/v1/chat/completions",
                DeepSeekVisionClient.resolveChatUrl("https://example.com/v1/chat/completions"));
    }

    @Test
    void parsesVisionAnswer() throws Exception {
        var response = objectMapper.readTree("""
                {"choices":[{"message":{"content":"截图里是一个聊天窗口。"}}]}
                """);

        assertEquals("截图里是一个聊天窗口。", DeepSeekVisionClient.parseContent(response));
    }

    @Test
    void rejectsEmptyVisionAnswer() throws Exception {
        var response = objectMapper.readTree("{\"choices\":[]}");

        assertThrows(ModelStudioException.class,
                () -> DeepSeekVisionClient.parseContent(response));
    }
}
