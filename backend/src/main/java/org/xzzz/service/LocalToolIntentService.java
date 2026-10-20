package org.xzzz.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.deepseek.DeepSeekChatModel;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.xzzz.entity.dto.LocalToolIntentResponse;

import java.util.Map;

/**
 * Uses the language model only as a local-tool router. The returned decision is
 * reduced to a fixed allowlist and never executes anything on the server.
 */
@Service
public class LocalToolIntentService {

    private static final int MAX_TARGET_LENGTH = 100;
    private static final String NONE = "none";
    private static final String OPEN_APPLICATION = "open_application";
    private static final String INSPECT_CURRENT_WINDOW = "inspect_current_window";

    private static final String ROUTER_PROMPT = """
            你是昔涟 AI 桌面客户端的本机工具意图路由器，只判断用户本轮是否需要调用工具。
            只能返回一个 JSON 对象，不要 Markdown、解释或额外文字，结构为：
            {"tool":"none|open_application|inspect_current_window","arguments":{"target":""}}

            可用工具：
            1. open_application：用户明确要求在自己的电脑上打开、启动或运行某个已安装的软件。
               target 只写软件的人类可读名称，不得写路径、参数、命令、URL、Shell、CMD 或 PowerShell。
            2. inspect_current_window：回答必须依赖用户此刻正在看的窗口、页面、报错、图片或界面内容。
               此工具不需要参数。
            3. none：普通聊天、知识问题、写作、天气、仅讨论某软件，或不需要读取/改变本机状态。

            宁可返回 none，也不要猜测危险操作。询问“如何打开某软件”不是要求实际打开，应返回 none。
            任何点击、输入、文件操作、终端命令、系统设置修改、登录或发送消息请求都返回 none。
            """;

    private final ChatClient planner;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${chat.request.max-prompt-chars:4000}")
    private int maxPromptChars;

    public LocalToolIntentService(DeepSeekChatModel model) {
        this.planner = ChatClient.builder(model).build();
    }

    public LocalToolIntentResponse plan(String prompt) {
        validatePrompt(prompt);
        String modelOutput = planner.prompt()
                .system(ROUTER_PROMPT)
                .user(prompt)
                .call()
                .content();
        return parseModelOutput(modelOutput, objectMapper);
    }

    static LocalToolIntentResponse parseModelOutput(String output, ObjectMapper mapper) {
        if (output == null || output.isBlank()) {
            return LocalToolIntentResponse.none();
        }

        try {
            int start = output.indexOf('{');
            int end = output.lastIndexOf('}');
            if (start < 0 || end < start) {
                return LocalToolIntentResponse.none();
            }
            JsonNode root = mapper.readTree(output.substring(start, end + 1));
            String tool = root.path("tool").asText(NONE).trim();

            if (OPEN_APPLICATION.equals(tool)) {
                String target = normalizeTarget(root.path("arguments").path("target").asText(""));
                if (target == null) {
                    return LocalToolIntentResponse.none();
                }
                return new LocalToolIntentResponse(
                        OPEN_APPLICATION,
                        Map.of("target", target),
                        "打开本机应用",
                        "确认后，昔涟会在本机应用目录中查找并启动“" + target + "”。",
                        true
                );
            }

            if (INSPECT_CURRENT_WINDOW.equals(tool)) {
                return new LocalToolIntentResponse(
                        INSPECT_CURRENT_WINDOW,
                        Map.of(),
                        "查看当前窗口",
                        "确认后，昔涟会截取当前前台窗口并上传截图给视觉模型分析。",
                        true
                );
            }
            return LocalToolIntentResponse.none();
        } catch (Exception ignored) {
            // A malformed or invented tool decision degrades to ordinary chat.
            return LocalToolIntentResponse.none();
        }
    }

    private void validatePrompt(String prompt) {
        if (prompt == null || prompt.isBlank()) {
            throw new IllegalArgumentException("prompt 不能为空");
        }
        if (prompt.length() > maxPromptChars) {
            throw new IllegalArgumentException("prompt 长度不能超过 " + maxPromptChars + " 个字符");
        }
    }

    private static String normalizeTarget(String target) {
        if (target == null || target.isBlank()) {
            return null;
        }
        String normalized = target.trim().replaceAll("[\\p{Cntrl}]", " ").replaceAll("\\s+", " ");
        if (normalized.length() > MAX_TARGET_LENGTH
                || normalized.contains("/")
                || normalized.contains("\\\\")
                || normalized.contains(":")
                || normalized.contains(";")
                || normalized.contains("|")
                || normalized.contains("&")) {
            return null;
        }
        return normalized;
    }
}
