package org.xzzz.service;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.xzzz.entity.ChatHistory;
import org.xzzz.entity.vo.ConversationVo;
import org.xzzz.mapper.ChatHistoryMapper;

import java.util.List;

/**
 * 聊天记录的读写入口。
 *
 * <p>MySQL 是聊天记录的唯一事实来源：前端回显和拼装大模型上下文都从这里读，
 * 不再使用 Redis 或 Spring AI 的内存 ChatMemory。
 *
 * <p>所有按会话读取的方法都会校验 {@code userId} 归属，避免拿到别人的会话 id 就能读到内容。
 */
@Service
@RequiredArgsConstructor
public class ChatHistoryService {

    /** 与 conversation.title 的列宽保持一致。 */
    private static final int TITLE_MAX_LENGTH = 200;
    /** 从消息内容派生标题时截取的长度。 */
    private static final int TITLE_FROM_MESSAGE_LENGTH = 30;

    private final ChatHistoryMapper chatHistoryMapper;

    /** 送入大模型的历史条数上限（不含系统提示词）。 */
    @Value("${chat.context.max-messages:20}")
    private int maxContextMessages;

    /** 送入大模型的历史正文总字数上限，超出则从最旧的开始丢弃。 */
    @Value("${chat.context.max-chars:12000}")
    private int maxContextChars;

    /**
     * 落库一条消息，并确保会话元数据存在。
     *
     * <p>同步执行，必须在读取上下文之前完成，否则读不到刚发出的这条消息。
     */
    public void save(String userId, String sessionId, String role, String content) {
        chatHistoryMapper.insert(ChatHistory.of(userId, sessionId, role, content));
        // 会话已存在时这里只刷新 updated_at，原标题不会被覆盖
        chatHistoryMapper.upsertConversation(sessionId, userId, deriveTitle(content));
    }

    /**
     * 读取一个会话的全部消息，按写入顺序返回，供前端回显。
     */
    public List<ChatHistory> getSessionMessages(String sessionId) {
        return chatHistoryMapper.selectBySessionId(sessionId);
    }

    /**
     * 拼装送入大模型的上下文：先按条数截断，再按总字数从最旧的开始丢弃。
     *
     * <p>系统提示词本身就要消耗约 2700 tokens，如果不限制历史长度，长会话会迅速撞上模型的
     * 上下文上限，成本也会线性上涨。最新一条（用户刚发的问题）永远保留。
     */
    public List<ChatHistory> getContextMessages(String sessionId) {
        List<ChatHistory> window = chatHistoryMapper.selectRecentBySessionId(sessionId, maxContextMessages);
        return trimToCharBudget(window, maxContextChars);
    }

    /**
     * 按总字数从最旧的开始丢弃，直到不超过预算；最新一条（用户刚发的问题）永远保留。
     *
     * <p>抽成静态方法是为了能脱离数据库做单元测试。
     */
    static List<ChatHistory> trimToCharBudget(List<ChatHistory> messages, int maxChars) {
        if (messages == null || messages.isEmpty()) {
            return List.of();
        }
        int totalChars = messages.stream().mapToInt(ChatHistoryService::contentLength).sum();
        int from = 0;
        while (from < messages.size() - 1 && totalChars > maxChars) {
            totalChars -= contentLength(messages.get(from));
            from++;
        }
        return List.copyOf(messages.subList(from, messages.size()));
    }

    private static int contentLength(ChatHistory message) {
        return message.getContent() == null ? 0 : message.getContent().length();
    }

    /**
     * 判断会话是否属于该用户。会话不存在或不属于该用户都返回 {@code false}。
     */
    public boolean isOwnedBy(String sessionId, String userId) {
        return chatHistoryMapper.countOwnedConversation(sessionId, userId) > 0;
    }

    /**
     * 会话列表。
     */
    public List<ConversationVo> listConversations(String userId) {
        return chatHistoryMapper.selectConversations(userId);
    }

    /**
     * 重命名会话。
     */
    public boolean renameConversation(String sessionId, String userId, String title) {
        if (title == null || title.isBlank()) {
            throw new IllegalArgumentException("title 不能为空");
        }
        String trimmed = title.strip();
        if (trimmed.length() > TITLE_MAX_LENGTH) {
            throw new IllegalArgumentException("title 长度不能超过 " + TITLE_MAX_LENGTH + " 个字符");
        }
        return chatHistoryMapper.renameConversation(sessionId, userId, trimmed) > 0;
    }

    /**
     * 删除整个会话（元数据 + 全部消息）。
     */
    @Transactional
    public boolean deleteConversation(String sessionId, String userId) {
        if (chatHistoryMapper.deleteConversation(sessionId, userId) == 0) {
            return false;
        }
        chatHistoryMapper.deleteMessagesBySessionId(sessionId);
        return true;
    }

    private static String deriveTitle(String content) {
        if (content == null || content.isBlank()) {
            return "新对话";
        }
        String trimmed = content.strip();
        return trimmed.length() <= TITLE_FROM_MESSAGE_LENGTH
                ? trimmed
                : trimmed.substring(0, TITLE_FROM_MESSAGE_LENGTH);
    }
}
