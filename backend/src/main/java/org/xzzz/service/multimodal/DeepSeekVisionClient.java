package org.xzzz.service.multimodal;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.xzzz.exception.ModelStudioException;
import tools.jackson.databind.JsonNode;

import java.util.Map;

/**
 * DeepSeek OpenAI 兼容视觉接口。
 *
 * <p>沿用文字对话已有的 DeepSeek 服务端密钥；前端和桌面安装包都不会接触密钥。
 */
@Component
public class DeepSeekVisionClient {

    private final RestClient restClient;
    private final String apiKey;
    private final String chatUrl;

    @Autowired
    public DeepSeekVisionClient(
            RestClient.Builder builder,
            @Value("${spring.ai.deepseek.api-key:}") String apiKey,
            @Value("${spring.ai.deepseek.base-url:https://api.deepseek.com}") String baseUrl
    ) {
        this(builder.build(), apiKey, resolveChatUrl(baseUrl));
    }

    DeepSeekVisionClient(RestClient restClient, String apiKey, String chatUrl) {
        this.restClient = restClient;
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.chatUrl = chatUrl == null ? "" : chatUrl.trim();
    }

    public String complete(Map<String, Object> payload) {
        if (apiKey.isBlank()) {
            throw new ModelStudioException("缺少 DEEPSEEK_API_KEY，无法分析窗口截图");
        }

        try {
            JsonNode response = restClient.post()
                    .uri(chatUrl)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(payload)
                    .retrieve()
                    .body(JsonNode.class);
            return parseContent(response);
        } catch (RestClientResponseException e) {
            throw new ModelStudioException("DeepSeek 视觉请求失败：HTTP " + e.getStatusCode().value(), e);
        } catch (RestClientException e) {
            throw new ModelStudioException("无法连接 DeepSeek 视觉接口：" + e.getMessage(), e);
        }
    }

    static String resolveChatUrl(String baseUrl) {
        String normalized = baseUrl == null ? "" : baseUrl.trim().replaceAll("/+$", "");
        if (normalized.isBlank()) {
            return "https://api.deepseek.com/chat/completions";
        }
        return normalized.endsWith("/chat/completions")
                ? normalized
                : normalized + "/chat/completions";
    }

    static String parseContent(JsonNode response) {
        String content = response == null
                ? ""
                : response.path("choices").path(0).path("message").path("content").asText("").trim();
        if (content.isBlank()) {
            throw new ModelStudioException("DeepSeek 没有返回可用的图片分析结果");
        }
        return content;
    }
}
