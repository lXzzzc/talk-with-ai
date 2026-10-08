# 构建阶段：在容器里编译打包
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# 可选：国内网络拉 Maven 依赖慢的话，构建时传 --build-arg MAVEN_MIRROR_URL=https://maven.aliyun.com/repository/public
ARG MAVEN_MIRROR_URL=""
RUN if [ -n "$MAVEN_MIRROR_URL" ]; then \
        mkdir -p /root/.m2 && \
        printf '%s' "<settings><mirrors><mirror><id>mirror</id><mirrorOf>*</mirrorOf><url>${MAVEN_MIRROR_URL}</url></mirror></mirrors></settings>" \
            > /root/.m2/settings.xml; \
    fi

# 先只复制 pom 并预热依赖，源码变动时可以复用这一层缓存
COPY pom.xml .
RUN mvn -B -q dependency:go-offline

COPY src ./src
RUN mvn -B -q clean package -DskipTests

# 运行阶段：只要 JRE
FROM eclipse-temurin:21-jre
WORKDIR /app

# 健康检查需要 curl；temurin 基础镜像里并不保证有 wget/curl，这里显式装上
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# 不用 root 跑应用
RUN useradd --system --uid 1001 appuser
COPY --from=build /build/target/*.jar app.jar
USER appuser

EXPOSE 8080
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75"
ENV SPRING_PROFILES_ACTIVE=prod

# 首次启动要跑 Flyway 建表，start-period 给足，避免刚起来就被判定 unhealthy
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=6 \
    CMD ["sh", "-c", "curl -fsS http://127.0.0.1:8080/actuator/health | grep -q UP"]

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
