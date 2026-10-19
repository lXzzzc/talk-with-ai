package org.xzzz.service.voice;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.socket.config.annotation.ServletWebSocketHandlerRegistry;
import org.springframework.web.servlet.handler.SimpleUrlHandlerMapping;
import org.xzzz.config.VoiceWebSocketConfiguration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class VoiceWebSocketMappingTest {
    @Test void voiceUpgradeHasPriorityOverTheLegacyHistoryWildcardRoute() {
        var config = new VoiceWebSocketConfiguration(mock(VoiceCallHandler.class));
        ReflectionTestUtils.setField(config, "allowedOrigins", new String[]{"http://localhost:5173"});
        var registry = new ServletWebSocketHandlerRegistry();
        config.registerWebSocketHandlers(registry);
        var mapping = (SimpleUrlHandlerMapping) registry.getHandlerMapping();
        assertThat(mapping.getOrder()).isLessThan(0);
        assertThat(mapping.getUrlMap()).containsKey("/voice/realtime");
    }
}
