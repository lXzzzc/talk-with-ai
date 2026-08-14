package org.xzzz.controller;


import lombok.RequiredArgsConstructor;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.chat.messages.Message;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.xzzz.entity.vo.MessageVo;
import org.xzzz.repository.ChatHistroyRepository;

import java.util.List;

@RequiredArgsConstructor
@RestController
@RequestMapping
public class ChatHistoryController {
    private final ChatHistroyRepository chatHistroyRepository;
    private final ChatMemory chatMemory;

    @GetMapping ("/getChatIds")
    public Object getConversationIds(@PathVariable("type") String type) {
            return chatHistroyRepository.getconversationIds(type);
    }
    @GetMapping("/{type}/{chatId}")
    public List<MessageVo> getChatHistory(@PathVariable("type") String type, @PathVariable("chatId") String chatId) {
            List<Message> messages= chatMemory.get(chatId);
            if(messages==null){
                return List.of();
            }
            return messages.stream().map(MessageVo::new).toList();
    }
}
