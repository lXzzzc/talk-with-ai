package org.xzzz.service.multimodal;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import tools.jackson.databind.JsonNode;
import org.xzzz.exception.ModelStudioException;

import java.util.Map;

/**
 * 阿里云百炼 OpenAI 兼容接口的服务端客户端。
 *
 * <p>密钥只存在 Spring Boot 进程的环境变量中，桌面端不会接触到它。
 */
@Component
public class ModelStudioClient {

    private final RestClient restClient;
    private final String apiKey;
    private final String chatUrl;

    @Autowired
    public ModelStudioClient(
            RestClient.Builder builder,
            @Value("${aliyun.model-studio.api-key:}") String apiKey,
            @Value("${aliyun.model-studio.chat-url:https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions}")
            String chatUrl
    ) {
        this(builder.build(), apiKey, chatUrl);
    }

    ModelStudioClient(RestClient restClient, String apiKey, String chatUrl) {
        this.restClient = restClient;
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.chatUrl = chatUrl == null ? "" : chatUrl.trim();
    }

    public ModelStudioCompletion complete(Map<String, Object> payload) {
        if (apiKey.isBlank()) {
            throw new ModelStudioException("缺少 DASHSCOPE_API_KEY，无法使用图像分析或语音识别");
        }
        if (chatUrl.isBlank()) {
            throw new ModelStudioException("未配置阿里云百炼 Chat Completions 地址");
        }

        try {
            JsonNode response = restClient.post()
                    .uri(chatUrl)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(payload)
                    .retrieve()
                    .body(JsonNode.class);
            return parseCompletion(response);
        } catch (RestClientResponseException e) {
            throw new ModelStudioException("阿里云百炼请求失败：HTTP " + e.getStatusCode().value(), e);
        } catch (RestClientException e) {
            throw new ModelStudioException("无法连接阿里云百炼：" + e.getMessage(), e);
        }
    }

    static ModelStudioCompletion parseCompletion(JsonNode response) {
        JsonNode message = response == null
                ? null
                : response.path("choices").path(0).path("message");
        String content = message == null ? "" : message.path("content").asText("").trim();
        if (content.isBlank()) {
            throw new ModelStudioException("阿里云百炼没有返回可用内容");
        }

        JsonNode annotation = message.path("annotations").path(0);
        return new ModelStudioCompletion(
                content,
                blankToNull(annotation.path("language").asText(null)),
                blankToNull(annotation.path("emotion").asText(null))
        );
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
