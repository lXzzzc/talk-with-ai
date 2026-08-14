# Talk with AI

一个基于 **Spring AI + Vue 3** 的 AI 对话应用，集成 DeepSeek 大模型对话、Redis 会话记忆、MySQL 历史记录持久化，并通过 Edge TTS 实现语音合成播放。

## 技术栈

**前端（`AI/`）**
- Vue 3 + Vite
- 流式对话（SSE）
- Edge TTS 语音播报（调用后端代理）

**后端（`backend/`）**
- Spring Boot 4（Java 21）
- Spring AI（DeepSeek Chat Model）
- Redis（会话消息缓存）
- MySQL + MyBatis（聊天历史持久化）
- Edge TTS（WebSocket 接入微软语音合成）

## 项目结构

```
talk with ai/
├── AI/                      # 前端（Vue 3 + Vite）
│   ├── src/
│   │   ├── App.vue          # 聊天主界面
│   │   ├── edge-tts.js      # TTS 客户端封装
│   │   ├── main.js
│   │   └── styles.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
└── backend/                 # 后端（Spring Boot）
    └── src/main/
        ├── java/org/xzzz/
        │   ├── config/      # 配置类（ChatClient、Redis、提示词读取）
        │   ├── controller/  # Chat / ChatHistory / TTS 接口
        │   ├── service/     # 对话服务、历史异步保存、TTS
        │   ├── repository/  # 会话仓库
        │   ├── mapper/      # MyBatis Mapper
        │   └── entity/      # 实体类
        └── resources/
            ├── application.yaml
            ├── prompt/xilian.txt   # 角色提示词
            └── sql/chat_history.sql
```

## 功能特性

- 多会话对话管理（新建 / 切换 / 本地持久化）
- SSE 流式输出，打字机效果
- DeepSeek 大模型对话，支持历史上下文
- 对话历史异步写入 MySQL，重启不丢失
- Edge TTS 语音播报（可开关、排队播放）
- 会话消息缓存于 Redis

## 环境要求

- JDK 21+
- Maven 3.6+
- Node.js 18+
- MySQL 8（数据库 `spring_ai_test`）
- Redis 6+

## 快速开始

### 1. 初始化数据库

```bash
mysql -u root -p < backend/src/main/resources/sql/chat_history.sql
```

### 2. 启动后端

编辑 `backend/src/main/resources/application.yaml`，配置你的数据库与 DeepSeek API Key：

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/spring_ai_test?useUnicode=true&characterEncoding=utf8&useSSL=false&serverTimezone=Asia/Shanghai
    username: root
    password: your-password
  ai:
    deepseek:
      api-key: "your-own-api-key"
```

然后启动：

```bash
cd backend
mvn spring-boot:run
```

后端默认运行在 `http://localhost:8080`。

### 3. 启动前端

```bash
cd AI
npm install
npm run dev
```

访问 `http://localhost:5173`。前端已通过 Vite 代理将 `/api` 转发到后端 `8080`。

## 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/ai/chat` | 普通对话（返回纯文本） |
| GET | `/ai/chat-stream` | SSE 流式对话 |
| GET | `/{type}/{chatId}` | 获取会话历史 |
| GET | `/ai/tts?text=...` | Edge TTS 语音合成（返回音频） |

## 配置说明

- `tts.voice`：TTS 音色，默认 `zh-CN-XiaoxiaoNeural`
- `tts.rate`：语速，默认 `0`
- 角色提示词位于 `backend/src/main/resources/prompt/xilian.txt`，可自定义修改

## 注意事项

- 对话上下文默认保存在 Redis，历史记录写入 MySQL。
- TTS 通过后端与微软 Edge TTS 建立 WebSocket 连接，需要外网访问。
- 请勿将真实 API Key 提交到版本库。

## License

仅供学习交流使用。
