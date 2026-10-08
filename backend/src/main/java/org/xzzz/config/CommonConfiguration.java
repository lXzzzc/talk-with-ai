package org.xzzz.config;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.SimpleLoggerAdvisor;
import org.springframework.ai.deepseek.DeepSeekChatModel;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;


@Configuration
public class CommonConfiguration {

    /**
     * 上下文由 {@code XiLianChatService} 从 MySQL 显式装配后传给 {@code .messages(...)}，
     * 因此这里不再注册内存版 {@code ChatMemory}，也不挂 {@code MessageChatMemoryAdvisor}：
     * 那个 advisor 会额外往 prompt 里注入一份记忆，与显式传入的历史重复。
     */
    @Bean
    public ChatClient chatClient(DeepSeekChatModel model, PromptFileReader promptFileReader) throws Exception{
        return ChatClient
                .builder(model)
                .defaultSystem(promptFileReader.readTxt("xilian.txt"))
                .defaultAdvisors(new SimpleLoggerAdvisor())
                .build();
    }
}
