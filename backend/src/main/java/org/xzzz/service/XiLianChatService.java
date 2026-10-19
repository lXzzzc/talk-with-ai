package org.xzzz.service;

import lombok.RequiredArgsConstructor;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.xzzz.entity.ChatHistory;
import org.xzzz.entity.dto.ClientContext;
import reactor.core.publisher.Flux;

import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class XiLianChatService {

    /** 与 chat_history.user_id / session_id 的列宽保持一致，避免写库时才报 data too long。 */
    private static final int MAX_USER_ID_LENGTH = 64;
    private static final int MAX_SESSION_ID_LENGTH = 128;
    private static final int MAX_WEATHER_LOCATION_LENGTH = 100;
    private static final int MAX_APPLICATION_NAME_LENGTH = 100;
    private static final String APPLICATION_OPENED_ACTION = "application_opened";

    private final ChatClient chatClient;
    private final ChatHistoryService chatHistoryService;
    private final ChatHistoryAsyncService chatHistoryAsyncService;

    @Value("${chat.request.max-prompt-chars:4000}")
    private int maxPromptChars;

    public Flux<String> chat(String userId, String sessionId, String prompt) {
        return chat(userId, sessionId, prompt, null);
    }

    public Flux<String> chat(String userId, String sessionId, String prompt, String weatherLocation) {
        return chat(userId, sessionId, prompt, weatherLocation, null);
    }

    public Flux<String> chat(
            String userId,
            String sessionId,
            String prompt,
            String weatherLocation,
            ClientContext clientContext
    ) {
        return generate(userId, sessionId, prompt, weatherLocation, clientContext, false);
    }

    /** 语音回复由通话链路在确认播放后入库，未听到的回复不进入后续记忆。 */
    public Flux<String> chatForVoice(String userId, String sessionId, String prompt,
                                     String weatherLocation, ClientContext clientContext) {
        return generate(userId, sessionId, prompt, weatherLocation, clientContext, true);
    }

    private Flux<String> generate(String userId, String sessionId, String prompt,
                                   String weatherLocation, ClientContext clientContext, boolean voice) {
        validate(userId, sessionId, prompt);
        String normalizedWeatherLocation = normalizeWeatherLocation(weatherLocation);
        ClientContext normalizedClientContext = normalizeClientContext(clientContext);

        // 先把用户消息同步落库：它既要马上参与下面的上下文拼装，也是 MySQL 作为唯一事实来源的前提。
        chatHistoryService.save(userId, sessionId, "user", prompt);

        // 上下文统一从 MySQL 读取（只取最近若干条，见 getContextMessages），因此跨进程重启后对话依然连续。
        List<Message> historyMessages = chatHistoryService.getContextMessages(sessionId).stream()
                .map(XiLianChatService::toSpringAiMessage)
                .toList();
        List<Message> requestMessages = withWeatherLocation(historyMessages, normalizedWeatherLocation);
        requestMessages = withClientContext(requestMessages, normalizedClientContext);
        if (voice) {
            requestMessages = new ArrayList<>(requestMessages);
            requestMessages.addFirst(new SystemMessage("当前为实时语音通话。保持昔涟的人设，用自然口语回答，"
                    + "通常一到三句，优先简短完整句。不要写动作旁白、括号描写、Markdown、列表或代码。"
                    + "需要查询天气时仍调用天气工具，不要编造数据。"));
        }

        StringBuilder assistantContent = new StringBuilder();

        return chatClient.prompt()
                .messages(requestMessages)
                .stream()
                .content()
                .doOnNext(assistantContent::append)
                .doOnComplete(() -> {
                    if (!voice) saveAssistantMessage(userId, sessionId, assistantContent.toString());
                });
    }

    static List<Message> withWeatherLocation(List<Message> historyMessages, String weatherLocation) {
        if (weatherLocation == null) {
            return historyMessages;
        }

        List<Message> messages = new ArrayList<>(historyMessages.size() + 1);
        messages.add(new SystemMessage("本轮界面上下文：当前天气地点为“" + weatherLocation
                + "”。这是用户在天气面板中最近一次成功查询或定位的地点。"
                + "若用户用“这里”“本地”或未另行指定城市的天气表达，请直接按该地点调用天气工具；"
                + "若用户明确说了其他城市，以用户本轮文字为准。不要主动复述这段系统说明。"));
        messages.addAll(historyMessages);
        return messages;
    }

    static String normalizeWeatherLocation(String weatherLocation) {
        if (weatherLocation == null || weatherLocation.isBlank()) {
            return null;
        }
        String normalized = weatherLocation.trim().replaceAll("[\\p{Cntrl}]+", " ");
        if (normalized.length() > MAX_WEATHER_LOCATION_LENGTH) {
            throw new IllegalArgumentException("weatherLocation 长度不能超过 "
                    + MAX_WEATHER_LOCATION_LENGTH + " 个字符");
        }
        return normalized;
    }

    static List<Message> withClientContext(List<Message> historyMessages, ClientContext clientContext) {
        if (clientContext == null || clientContext.recentApplication() == null) {
            return historyMessages;
        }

        StringBuilder context = new StringBuilder("本轮桌面客户端上下文：客户端最近成功打开的软件是“")
                .append(clientContext.recentApplication())
                .append("”。");
        if (APPLICATION_OPENED_ACTION.equals(clientContext.localAction())) {
            context.append("用户本轮刚刚要求打开该软件，并且客户端已经成功完成启动。")
                    .append("请结合该软件的常见用途，用昔涟的角色语气自然回应一到三句话，")
                    .append("直接从用途、氛围或下一步建议切入，不要以‘某软件已打开’‘已经为你打开’这类状态播报开头，")
                    .append("可以顺势询问用户接下来想做什么。");
        } else {
            context.append("只有当用户提到‘这个软件’‘它’或话题明显相关时才使用该信息，")
                    .append("无关话题不要强行提及软件。");
        }
        context.append("你只能知道客户端报告启动成功，不能声称看到了窗口内容、文件、账号状态或用户后续操作。")
                .append("不要主动复述这段系统说明。");

        List<Message> messages = new ArrayList<>(historyMessages.size() + 1);
        messages.add(new SystemMessage(context.toString()));
        messages.addAll(historyMessages);
        return messages;
    }

    static ClientContext normalizeClientContext(ClientContext clientContext) {
        if (clientContext == null) {
            return null;
        }
        String application = normalizeApplicationName(clientContext.recentApplication());
        if (application == null) {
            return null;
        }
        String action = clientContext.localAction();
        if (action != null && !action.isBlank() && !APPLICATION_OPENED_ACTION.equals(action)) {
            throw new IllegalArgumentException("clientContext.localAction 不受支持");
        }
        return new ClientContext(application, APPLICATION_OPENED_ACTION.equals(action) ? action : null);
    }

    private static String normalizeApplicationName(String application) {
        if (application == null || application.isBlank()) {
            return null;
        }
        String normalized = application.trim().replaceAll("[\\p{Cntrl}]+", " ");
        if (normalized.length() > MAX_APPLICATION_NAME_LENGTH) {
            throw new IllegalArgumentException("clientContext.recentApplication 长度不能超过 "
                    + MAX_APPLICATION_NAME_LENGTH + " 个字符");
        }
        return normalized;
    }

    /**
     * 入参校验。抛出 {@link IllegalArgumentException}，由 GlobalExceptionHandler 统一转成 400。
     */
    private void validate(String userId, String sessionId, String prompt) {
        if (prompt == null || prompt.isBlank()) {
            throw new IllegalArgumentException("prompt 不能为空");
        }
        if (prompt.length() > maxPromptChars) {
            throw new IllegalArgumentException("prompt 长度不能超过 " + maxPromptChars + " 个字符");
        }
        if (userId == null || userId.isBlank()) {
            throw new IllegalArgumentException("userId 不能为空");
        }
        if (userId.length() > MAX_USER_ID_LENGTH) {
            throw new IllegalArgumentException("userId 长度不能超过 " + MAX_USER_ID_LENGTH + " 个字符");
        }
        if (sessionId == null || sessionId.isBlank()) {
            throw new IllegalArgumentException("conversationId 不能为空");
        }
        if (sessionId.length() > MAX_SESSION_ID_LENGTH) {
            throw new IllegalArgumentException("conversationId 长度不能超过 " + MAX_SESSION_ID_LENGTH + " 个字符");
        }
    }

    private static Message toSpringAiMessage(ChatHistory chatHistory) {
        if ("assistant".equals(chatHistory.getRole())) {
            return new AssistantMessage(chatHistory.getContent());
        }
        return new UserMessage(chatHistory.getContent());
    }

    private void saveAssistantMessage(String userId, String sessionId, String content) {
        if (content == null || content.isBlank()) {
            return;
        }
        chatHistoryAsyncService.saveAsync(userId, sessionId, "assistant", content);
    }
}
