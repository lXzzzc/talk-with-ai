package org.xzzz.service.multimodal;

import org.junit.jupiter.api.Test;
import org.xzzz.exception.ModelStudioException;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ModelStudioClientTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void parsesTextAndAsrAnnotations() throws Exception {
        var response = objectMapper.readTree("""
                {
                  "choices": [{
                    "message": {
                      "content": "今天天气很好",
                      "annotations": [{"language": "zh", "emotion": "happy"}]
                    }
                  }]
                }
                """);

        ModelStudioCompletion completion = ModelStudioClient.parseCompletion(response);

        assertEquals("今天天气很好", completion.content());
        assertEquals("zh", completion.language());
        assertEquals("happy", completion.emotion());
    }

    @Test
    void rejectsAResponseWithoutContent() throws Exception {
        var response = objectMapper.readTree("{\"choices\": []}");

        assertThrows(ModelStudioException.class, () -> ModelStudioClient.parseCompletion(response));
    }
}
