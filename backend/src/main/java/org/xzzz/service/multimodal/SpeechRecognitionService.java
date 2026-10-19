package org.xzzz.service.multimodal;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.xzzz.entity.vo.SpeechRecognitionVo;
import org.xzzz.exception.ModelStudioException;

import java.io.IOException;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 「按住说话」的单次语音识别。
 */
@Service
public class SpeechRecognitionService {

    private static final Set<String> ALLOWED_AUDIO_TYPES = Set.of(
            "audio/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3",
            "audio/aac", "audio/flac", "audio/x-flac", "audio/mp4"
    );

    private final ModelStudioClient client;
    private final String model;
    private final long maxAudioBytes;

    public SpeechRecognitionService(
            ModelStudioClient client,
            @Value("${asr.aliyun.model:qwen3-asr-flash}") String model,
            @Value("${asr.max-audio-bytes:8388608}") long maxAudioBytes
    ) {
        this.client = client;
        this.model = model;
        this.maxAudioBytes = maxAudioBytes;
    }

    public SpeechRecognitionVo transcribe(MultipartFile audio) {
        if (audio == null || audio.isEmpty()) {
            throw new IllegalArgumentException("录音不能为空");
        }
        if (audio.getSize() > maxAudioBytes) {
            throw new IllegalArgumentException("录音不能超过 " + maxAudioBytes + " 字节");
        }

        String mediaType = normalizeMediaType(audio.getContentType());
        if (!ALLOWED_AUDIO_TYPES.contains(mediaType)) {
            throw new IllegalArgumentException("不支持的录音格式：" + mediaType);
        }

        byte[] bytes;
        try {
            bytes = audio.getBytes();
        } catch (IOException e) {
            throw new ModelStudioException("读取录音失败", e);
        }
        String dataUrl = "data:" + mediaType + ";base64," + Base64.getEncoder().encodeToString(bytes);

        Map<String, Object> payload = Map.of(
                "model", model,
                "messages", List.of(Map.of(
                        "role", "user",
                        "content", List.of(Map.of(
                                "type", "input_audio",
                                "input_audio", Map.of("data", dataUrl)
                        ))
                )),
                "stream", false,
                "asr_options", Map.of("enable_itn", true)
        );

        ModelStudioCompletion completion = client.complete(payload);
        return new SpeechRecognitionVo(completion.content(), completion.language(), completion.emotion());
    }

    static String normalizeMediaType(String contentType) {
        if (contentType == null || contentType.isBlank()) {
            return "application/octet-stream";
        }
        return contentType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
    }
}
