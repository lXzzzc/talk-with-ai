package org.xzzz.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.xzzz.entity.vo.SpeechRecognitionVo;
import org.xzzz.entity.vo.VisionAnalysisVo;
import org.xzzz.service.multimodal.SpeechRecognitionService;
import org.xzzz.service.multimodal.VisionService;

@RequiredArgsConstructor
@RestController
@RequestMapping("/ai")
public class MultimodalController {

    private final SpeechRecognitionService speechRecognitionService;
    private final VisionService visionService;

    @PostMapping(value = "/asr", consumes = MediaType.MULTIPART_FORM_DATA_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public SpeechRecognitionVo transcribe(@RequestPart("audio") MultipartFile audio) {
        return speechRecognitionService.transcribe(audio);
    }

    @PostMapping(value = "/vision", consumes = MediaType.MULTIPART_FORM_DATA_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public VisionAnalysisVo analyzeWindow(
            @RequestParam String userId,
            @RequestParam String conversationId,
            @RequestParam(required = false) String question,
            @RequestParam(required = false) String windowTitle,
            @RequestPart("image") MultipartFile image
    ) {
        return visionService.analyze(userId, conversationId, question, windowTitle, image);
    }
}
