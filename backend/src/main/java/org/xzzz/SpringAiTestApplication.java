package org.xzzz;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

@EnableAsync
@SpringBootApplication
public class SpringAiTestApplication {

    public static void main(String[] args) {
        SpringApplication.run(SpringAiTestApplication.class, args);
    }

}
