package org.xzzz.config;

import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

@Component
public class PromptFileReader {

    private final ResourceLoader resourceLoader;

    public PromptFileReader(ResourceLoader resourceLoader) {
        this.resourceLoader = resourceLoader;
    }

    /**
     * 以流的方式读取 classpath 下的文本资源。
     *
     * <p>这里不能用 {@code resource.getFile()}：应用打成可执行 jar 之后，classpath 资源位于
     * jar 内部而不是文件系统上，{@code getFile()} 会抛
     * {@code FileNotFoundException: class path resource [prompt/xxx.txt] cannot be resolved to
     * absolute file path}，直接导致上下文启动失败（只有 IDE / spring-boot:run 这类展开目录的
     * 场景才侥幸能用）。走 {@code getInputStream()} 则对两种部署形态都成立。
     */
    public String readTxt(String fileName) throws IOException {
        Resource resource = resourceLoader.getResource("classpath:prompt/" + fileName);
        try (InputStream inputStream = resource.getInputStream()) {
            return new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
