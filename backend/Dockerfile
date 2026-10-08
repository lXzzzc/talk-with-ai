# 构建阶段：在容器里编译打包
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# 先只复制 pom 并预热依赖，源码变动时可以复用这一层缓存
COPY pom.xml .
RUN mvn -B -q dependency:go-offline

COPY src ./src
RUN mvn -B -q clean package -DskipTests

# 运行阶段：只要 JRE
FROM eclipse-temurin:21-jre
WORKDIR /app

# 不用 root 跑应用
RUN useradd --system --uid 1001 appuser
COPY --from=build /build/target/*.jar app.jar
USER appuser

EXPOSE 8080
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75"
ENV SPRING_PROFILES_ACTIVE=prod

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
    CMD ["sh", "-c", "wget -qO- http://127.0.0.1:8080/actuator/health | grep -q UP"]

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
