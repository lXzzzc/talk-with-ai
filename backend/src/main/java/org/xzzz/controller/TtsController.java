package org.xzzz.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.xzzz.entity.dto.TtsRequest;
import org.xzzz.service.tts.TtsService;

@RequiredArgsConstructor
@RestController
@RequestMapping("/ai")
public class TtsController {

    private final TtsService ttsService;

    /** 单次合成的文本长度上限，防止被拿来当免费的 TTS 网关刷。 */
    @Value("${tts.max-text-chars:500}")
    private int maxTextChars;

    /**
     * 推荐用法：POST + JSON body。返回阿里云 Voice Studio WAV 音频。
     */
    @PostMapping(value = "/tts", produces = "audio/wav")
    public ResponseEntity<byte[]> ttsPost(@RequestBody TtsRequest request) {
        return synthesize(request.text());
    }

    /**
     * GET 版本保留用于兼容旧调用方。长文本请改用 POST，GET 会受 URL 长度限制。
     */
    @GetMapping(value = "/tts", produces = "audio/wav")
    public ResponseEntity<byte[]> tts(@RequestParam String text) {
        return synthesize(text);
    }

    /**
     * 这里不再 try/catch 吞掉异常：让异常抛给 GlobalExceptionHandler，返回统一的 JSON 错误体，
     * 而不是一个 body 为空的 500。
     */
    private ResponseEntity<byte[]> synthesize(String text) {
        if (text == null || text.isBlank()) {
            throw new IllegalArgumentException("text 不能为空");
        }
        if (text.length() > maxTextChars) {
            throw new IllegalArgumentException("text 长度不能超过 " + maxTextChars + " 个字符");
        }

        byte[] audio = ttsService.synthesize(text);
        return ResponseEntity.ok()
                .header("Content-Type", "audio/wav")
                .header("Cache-Control", "public, max-age=86400")
                .body(audio);
    }
}
