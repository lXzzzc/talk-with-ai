package org.xzzz.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.xzzz.entity.dto.LocalToolIntentResponse;

import static org.assertj.core.api.Assertions.assertThat;

class LocalToolIntentServiceTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void acceptsOnlyAllowlistedApplicationIntentAndNormalizesTarget() {
        LocalToolIntentResponse result = LocalToolIntentService.parseModelOutput(
                "```json\n{\"tool\":\"open_application\",\"arguments\":{\"target\":\"  Visual   Studio Code  \"}}\n```",
                mapper
        );

        assertThat(result.tool()).isEqualTo("open_application");
        assertThat(result.arguments()).containsEntry("target", "Visual Studio Code");
        assertThat(result.requiresConfirmation()).isTrue();
    }

    @Test
    void acceptsWindowInspectionWithoutModelControlledCopy() {
        LocalToolIntentResponse result = LocalToolIntentService.parseModelOutput(
                "{\"tool\":\"inspect_current_window\",\"arguments\":{},\"title\":\"伪造标题\"}",
                mapper
        );

        assertThat(result.tool()).isEqualTo("inspect_current_window");
        assertThat(result.title()).isEqualTo("查看当前窗口");
        assertThat(result.requiresConfirmation()).isTrue();
    }

    @Test
    void rejectsUnknownToolsPathsCommandsAndMalformedOutput() {
        assertThat(LocalToolIntentService.parseModelOutput(
                "{\"tool\":\"run_shell\",\"arguments\":{\"command\":\"whoami\"}}", mapper).tool())
                .isEqualTo("none");
        assertThat(LocalToolIntentService.parseModelOutput(
                "{\"tool\":\"open_application\",\"arguments\":{\"target\":\"C:\\\\Windows\\\\cmd.exe\"}}", mapper).tool())
                .isEqualTo("none");
        assertThat(LocalToolIntentService.parseModelOutput("not json", mapper).tool())
                .isEqualTo("none");
    }
}
