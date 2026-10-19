package org.xzzz.service.multimodal;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockMultipartFile;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SpeechRecognitionServiceTest {

    @Test
    void submitsAudioAsADataUrl() {
        ModelStudioClient client = mock(ModelStudioClient.class);
        when(client.complete(org.mockito.ArgumentMatchers.anyMap()))
                .thenReturn(new ModelStudioCompletion("你好", "zh", null));
        var service = new SpeechRecognitionService(client, "qwen3-asr-flash", 1024);
        var audio = new MockMultipartFile("audio", "voice.webm", "audio/webm;codecs=opus",
                new byte[]{1, 2, 3});

        var result = service.transcribe(audio);

        assertEquals("你好", result.text());
        ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
        verify(client).complete(payload.capture());
        assertEquals("qwen3-asr-flash", payload.getValue().get("model"));
        assertTrue(payload.getValue().toString().contains("data:audio/webm;base64,AQID"));
    }

    @Test
    void rejectsUnsupportedAudio() {
        var service = new SpeechRecognitionService(mock(ModelStudioClient.class), "model", 1024);
        var audio = new MockMultipartFile("audio", "voice.bin", "application/octet-stream",
                new byte[]{1});

        assertThrows(IllegalArgumentException.class, () -> service.transcribe(audio));
    }
}
