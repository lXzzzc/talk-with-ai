package org.xzzz.controller;


import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.xzzz.entity.dto.RenameRequest;
import org.xzzz.entity.vo.ConversationVo;
import org.xzzz.entity.vo.MessageVo;
import org.xzzz.service.ChatHistoryService;

import java.util.List;

/**
 * 聊天记录查询/删除。
 *
 * <p>所有接口都要求传 {@code userId}，并且只会返回该用户自己的数据——原先不传 userId 时
 * 会把所有用户的会话都列出来，属于越权读取。
 */
@RequiredArgsConstructor
@RestController
@RequestMapping
public class ChatHistoryController {

    private final ChatHistoryService chatHistoryService;

    /**
     * 会话列表，数据来自 chat_history 表的聚合查询。
     */
    @GetMapping("/getChatIds")
    public List<ConversationVo> getConversationIds(@RequestParam("userId") String userId) {
        return chatHistoryService.listConversations(userId);
    }

    /**
     * 读取某个会话的历史消息。
     *
     * <p>{@code type} 是历史遗留的路径片段（数据库里没有这个维度），保留只是为了不改动 URL 形态。
     */
    @GetMapping("/{type}/{chatId}")
    public List<MessageVo> getChatHistory(@PathVariable("type") String type,
                                         @PathVariable("chatId") String chatId,
                                         @RequestParam("userId") String userId) {
        requireOwned(chatId, userId);
        return chatHistoryService.getSessionMessages(chatId).stream()
                .map(MessageVo::new)
                .toList();
    }

    /**
     * 删除整个会话。
     */
    @DeleteMapping("/{type}/{chatId}")
    public ResponseEntity<Void> deleteChatHistory(@PathVariable("type") String type,
                                                  @PathVariable("chatId") String chatId,
                                                  @RequestParam("userId") String userId) {
        requireOwned(chatId, userId);
        chatHistoryService.deleteConversation(chatId, userId);
        return ResponseEntity.noContent().build();
    }

    /**
     * 重命名会话。
     */
    @PatchMapping("/{type}/{chatId}")
    public ResponseEntity<Void> renameChatHistory(@PathVariable("type") String type,
                                                  @PathVariable("chatId") String chatId,
                                                  @RequestParam("userId") String userId,
                                                  @RequestBody RenameRequest request) {
        requireOwned(chatId, userId);
        chatHistoryService.renameConversation(chatId, userId, request.title());
        return ResponseEntity.noContent().build();
    }

    private void requireOwned(String chatId, String userId) {
        if (!chatHistoryService.isOwnedBy(chatId, userId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "会话不存在");
        }
    }
}
