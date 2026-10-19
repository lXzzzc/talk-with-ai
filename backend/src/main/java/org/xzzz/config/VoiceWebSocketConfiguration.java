package org.xzzz.config;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.config.annotation.ServletWebSocketHandlerRegistry;
import org.xzzz.service.voice.VoiceCallHandler;

@Configuration
@EnableWebSocket
@RequiredArgsConstructor
public class VoiceWebSocketConfiguration implements WebSocketConfigurer {
    private final VoiceCallHandler handler;

    @Value("${voice.allowed-origins:http://localhost:5173,http://127.0.0.1:5173,http://tauri.localhost,tauri://localhost}")
    private String[] allowedOrigins;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        // 历史记录兼容接口 /{type}/{chatId} 会匹配 /voice/realtime；升级路由必须先于 MVC。
        if (registry instanceof ServletWebSocketHandlerRegistry servletRegistry) servletRegistry.setOrder(-1);
        registry.addHandler(handler, "/voice/realtime").setAllowedOrigins(allowedOrigins);
    }
}
