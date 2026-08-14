package org.xzzz.config;

import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Component;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

@Component
public class PromptFileReader {

    private final ResourceLoader resourceLoader;

    public PromptFileReader(ResourceLoader resourceLoader) {
        this.resourceLoader = resourceLoader;
    }

    public String readTxt(String fileName) throws Exception {
        Resource resource = resourceLoader.getResource("classpath:prompt/" + fileName);
        return Files.readString(resource.getFile().toPath(), StandardCharsets.UTF_8);
    }
}