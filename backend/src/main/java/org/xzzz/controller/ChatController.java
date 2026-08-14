package org.xzzz.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.xzzz.repository.ChatHistroyRepository;
import org.xzzz.service.XiLianChatService;
import reactor.core.publisher.Flux;

@RequiredArgsConstructor
@RestController
@RequestMapping("/ai")
public class ChatController {

    private final XiLianChatService xiLianChatService;
    private final ChatHistroyRepository chatHistoryRepository;

    @GetMapping(value = "/chat", produces = "text/html; charset=utf-8")
    public Flux<String> chat(
            @RequestParam(defaultValue = "default") String userId,
            @RequestParam String prompt,
            @RequestParam(defaultValue = "default") String conversationId) {
        chatHistoryRepository.save("chat", conversationId);
        return xiLianChatService.chat(userId, conversationId, prompt);
    }

    @GetMapping(value = "/chat-stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> chatStream(
            @RequestParam(defaultValue = "default") String userId,
            @RequestParam String prompt,
            @RequestParam(defaultValue = "default") String conversationId) {
        chatHistoryRepository.save("chat", conversationId);
        return xiLianChatService.chat(userId, conversationId, prompt)
                .map(chunk -> ServerSentEvent.<String>builder()
                        .data(chunk)
                        .build())
                .concatWithValues(
                        ServerSentEvent.<String>builder()
                                .event("done")
                                .data("[DONE]")
                                .build()
                );
    }
}