package org.xzzz.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

/**
 * 异步落库所用的线程池。
 *
 * <p>之前没有显式配置 executor，Spring 会退回 {@code SimpleAsyncTaskExecutor}：<b>每个任务新建一个
 * 线程且没有上限</b>，并发一高就会疯狂创建线程；而且默认不等待在途任务，关闭进程时会直接丢掉
 * 尚未写完的聊天记录。
 */
@Configuration
public class AsyncConfiguration {

    @Bean(name = "chatHistoryExecutor")
    public ThreadPoolTaskExecutor chatHistoryExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(8);
        executor.setQueueCapacity(500);
        executor.setThreadNamePrefix("chat-history-");
        // 队列满时由调用线程执行，形成背压，而不是静默丢弃
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        // 关闭时等待在途写入完成，避免丢消息
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(10);
        executor.initialize();
        return executor;
    }
}
