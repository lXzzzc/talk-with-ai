package org.xzzz.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.xzzz.entity.dto.ChatRequest;
import org.xzzz.service.XiLianChatService;
import reactor.core.publisher.Flux;

@RequiredArgsConstructor
@RestController
@RequestMapping("/ai")
public class ChatController {

    private final XiLianChatService xiLianChatService;

    /**
     * 推荐用法：POST + JSON body，避免 prompt 出现在 URL、访问日志和代理缓存里，也不受 URL 长度限制。
     */
    @PostMapping(value = "/chat", produces = "text/html; charset=utf-8")
    public Flux<String> chatPost(@RequestBody ChatRequest request) {
        return xiLianChatService.chat(request.userId(), request.conversationId(), request.prompt());
    }

    @PostMapping(value = "/chat-stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> chatStreamPost(@RequestBody ChatRequest request) {
        return toSse(xiLianChatService.chat(request.userId(), request.conversationId(), request.prompt()));
    }

    /**
     * GET 版本保留用于兼容旧调用方（如直接用浏览器点开的调试链接）。
     * 新代码请使用上面的 POST。
     */
    @GetMapping(value = "/chat", produces = "text/html; charset=utf-8")
    public Flux<String> chat(
            @RequestParam(defaultValue = "default") String userId,
            @RequestParam String prompt,
            @RequestParam(defaultValue = "default") String conversationId) {
        return xiLianChatService.chat(userId, conversationId, prompt);
    }

    @GetMapping(value = "/chat-stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> chatStream(
            @RequestParam(defaultValue = "default") String userId,
            @RequestParam String prompt,
            @RequestParam(defaultValue = "default") String conversationId) {
        return toSse(xiLianChatService.chat(userId, conversationId, prompt));
    }

    private Flux<ServerSentEvent<String>> toSse(Flux<String> chunks) {
        return chunks
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
