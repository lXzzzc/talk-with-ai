package org.xzzz.service.voice;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.*;

class VoiceProtocolTest {
    @Test void derivesWorkspaceAsrAddressWithoutExposingApiKey() {
        assertThat(RealtimeAsrClient.endpoint("", "https://space.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
                "qwen3-asr-flash-realtime").toString())
                .isEqualTo("wss://space.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime");
        assertThatThrownBy(() -> RealtimeAsrClient.endpoint("ws://example.com", "https://example.com", "model"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test void filtersActionsSplitAcrossTokensAndFlushesResidualSpeech() {
        VoiceTextBuffer buffer = new VoiceTextBuffer();
        assertThat(buffer.append("（轻轻")).isEmpty();
        assertThat(buffer.append("笑）你好呀！今天想")).containsExactly("你好呀！");
        assertThat(buffer.append("聊什么")).isEmpty();
        assertThat(buffer.finish()).isEqualTo("今天想聊什么");
        assertThat(buffer.finish()).isEmpty();
    }

    @Test void rejectsOversizedIdentityBeforeOpeningBillableConnections() {
        var json = JsonMapper.builder().build();
        assertThatThrownBy(() -> VoiceCallHandler.field(json.readTree("{\"userId\":\"\"}"), "userId", 64, true))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> VoiceCallHandler.field(json.readTree("{\"userId\":42}"), "userId", 64, true))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(VoiceCallHandler.field(json.readTree("{}"), "weatherLocation", 100, false)).isEmpty();
    }
}
