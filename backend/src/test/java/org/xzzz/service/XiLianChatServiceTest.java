package org.xzzz.service;

import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.xzzz.entity.dto.ClientContext;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class XiLianChatServiceTest {

    @Test
    void normalizesWeatherLocationForChatContext() {
        assertThat(XiLianChatService.normalizeWeatherLocation("  成都\n四川  "))
                .isEqualTo("成都 四川");
        assertThat(XiLianChatService.normalizeWeatherLocation("  ")).isNull();
        assertThat(XiLianChatService.normalizeWeatherLocation(null)).isNull();
    }

    @Test
    void rejectsOverlongWeatherLocation() {
        assertThatThrownBy(() -> XiLianChatService.normalizeWeatherLocation("成".repeat(101)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("weatherLocation 长度不能超过 100");
    }

    @Test
    void prependsCurrentWeatherLocationToEveryChatRequest() {
        UserMessage userMessage = new UserMessage("这里今天天气怎么样？");

        List<Message> messages = XiLianChatService.withWeatherLocation(
                List.of(userMessage),
                "成都 · 四川 · 中国"
        );

        assertThat(messages).hasSize(2);
        assertThat(messages.getFirst()).isInstanceOf(SystemMessage.class);
        assertThat(messages.getFirst().getText()).contains("成都 · 四川 · 中国", "直接按该地点调用天气工具");
        assertThat(messages.get(1)).isSameAs(userMessage);
    }

    @Test
    void addsNaturalConversationInstructionsAfterOpeningAnApplication() {
        UserMessage userMessage = new UserMessage("打开 Visual Studio Code");
        ClientContext context = XiLianChatService.normalizeClientContext(
                new ClientContext("  Visual Studio Code\n", "application_opened")
        );

        List<Message> messages = XiLianChatService.withClientContext(List.of(userMessage), context);

        assertThat(messages).hasSize(2);
        assertThat(messages.getFirst()).isInstanceOf(SystemMessage.class);
        assertThat(messages.getFirst().getText())
                .contains("Visual Studio Code", "自然回应一到三句话", "不要以‘某软件已打开’", "不能声称看到了窗口内容")
                .doesNotContain("Visual Studio Code\n");
        assertThat(messages.get(1)).isSameAs(userMessage);
    }

    @Test
    void rejectsUnsupportedClientActionsAndOverlongApplicationNames() {
        assertThatThrownBy(() -> XiLianChatService.normalizeClientContext(
                new ClientContext("微信", "execute_arbitrary_command")
        ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("localAction 不受支持");

        assertThatThrownBy(() -> XiLianChatService.normalizeClientContext(
                new ClientContext("软".repeat(101), "application_opened")
        ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("recentApplication 长度不能超过 100");
    }
}
