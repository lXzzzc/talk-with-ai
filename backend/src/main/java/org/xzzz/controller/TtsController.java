package org.xzzz.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.xzzz.service.tts.TtsService;

@Slf4j
@RequiredArgsConstructor
@RestController
@RequestMapping("/ai")
public class TtsController {

    private final TtsService ttsService;

    @GetMapping(value = "/tts", produces = "audio/mpeg")
    public ResponseEntity<byte[]> tts(@RequestParam String text) {
        if (text == null || text.isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        try {
            byte[] audio = ttsService.synthesize(text);
            return ResponseEntity.ok()
                    .header("Content-Type", "audio/mpeg")
                    .body(audio);
        } catch (Exception e) {
            log.error("TTS synthesis failed for text: {}", text, e);
            return ResponseEntity.internalServerError().build();
        }
    }
}