# Talk with AI

一个基于 **Spring AI + Vue 3** 的 AI 对话应用，集成 DeepSeek 大模型对话、MySQL 聊天记录持久化，并通过 Edge TTS 实现语音合成播放。

## 技术栈

**前端（`AI/`）**
- Vue 3 + Vite
- 流式对话（SSE）
- Markdown 渲染（marked + DOMPurify 消毒）
- Edge TTS 语音播报（调用后端代理）

**后端（`backend/`）**
- Spring Boot 4（Java 21）
- Spring AI 2.0（DeepSeek Chat Model）
- MySQL + MyBatis（聊天记录持久化）
- Flyway（数据库版本管理）
- Actuator（健康检查）
- Edge TTS（WebSocket 接入微软语音合成）

> 聊天记录以 **MySQL 为唯一事实来源**：前端回显和拼装大模型上下文都从数据库读取，
> 不再依赖 Redis 或 Spring AI 的内存 ChatMemory，因此进程重启后对话上下文依然连续。

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
│   └── vite.config.js       # 开发期把 /api 代理到后端 8080
└── backend/                 # 后端（Spring Boot）
    ├── .env.example         # 密钥模板（复制为 .env，已被 gitignore）
    └── src/main/
        ├── java/org/xzzz/
        │   ├── config/      # ChatClient、跨域、提示词读取
        │   ├── controller/  # Chat / ChatHistory / TTS 接口
        │   ├── service/     # 对话服务、聊天记录读写、TTS
        │   ├── mapper/      # MyBatis Mapper
        │   └── entity/      # 实体类与 VO
        └── resources/
            ├── application.yaml
            ├── prompt/xilian.txt   # 角色提示词
            └── sql/chat_history.sql
```

## 功能特性

- 多会话对话管理（新建 / 切换 / **重命名 / 删除**）
- SSE 流式输出，打字机效果
- DeepSeek 大模型对话，上下文跨进程重启保持
- AI 回复按 Markdown 渲染（代码块、列表、表格等）
- 聊天记录持久化到 MySQL，前端会话列表从数据库读取
- 按用户隔离的会话数据（匿名 userId，见下文说明）
- Edge TTS 语音播报（可开关、排队播放、结果带 LRU 缓存）
- 统一的错误响应、全局异常处理、健康检查

## 环境要求

- JDK 21+
- Maven 3.6+
- Node.js 18+
- MySQL 8（数据库 `spring_ai_test`）

> 不再需要 Redis。

## 快速开始

### 1. 初始化数据库

```bash
mysql -u root -p < backend/src/main/resources/sql/chat_history.sql
```

### 2. 配置密钥

复制模板并填入真实值：

```bash
cd backend
cp .env.example .env
```

```properties
# backend/.env
DB_PASSWORD=你的数据库密码
DEEPSEEK_API_KEY=你的 DeepSeek API Key
```

`backend/.env` 已被 `.gitignore` 忽略，**不会提交到版本库**。也可以不用这个文件，
直接设置同名环境变量（生产环境推荐）。

### 3. 启动后端

```bash
cd backend
mvn spring-boot:run
```

或先打包再运行：

```bash
cd backend
mvn clean package -DskipTests
java -jar target/spring-ai-test-0.0.1-SNAPSHOT.jar
```

后端默认运行在 `http://localhost:8080`。

### 4. 启动前端

```bash
cd AI
npm install
npm run dev
```

访问 `http://localhost:5173`。开发期 Vite 已把 `/api` 代理到后端 `8080`。

## 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/ai/chat` | **推荐**。Body: `{userId, conversationId, prompt}`，返回纯文本流 |
| POST | `/ai/chat-stream` | **推荐**。同上，返回 SSE |
| GET | `/ai/chat?userId=&prompt=&conversationId=` | 兼容旧调用方，prompt 请改用 POST |
| GET | `/ai/chat-stream?...` | 兼容旧调用方 |
| GET | `/getChatIds?userId=` | 会话列表（**userId 必填**） |
| GET | `/{type}/{chatId}?userId=` | 会话历史（`type` 固定为 `chat`，仅为历史遗留的路径片段） |
| PATCH | `/{type}/{chatId}?userId=` | 重命名会话，Body: `{title}` |
| DELETE | `/{type}/{chatId}?userId=` | 删除会话 |
| POST | `/ai/tts` | **推荐**。Body: `{text}`，返回 `audio/mpeg` |
| GET | `/ai/tts?text=...` | 兼容旧调用方，长文本请改用 POST |
| GET | `/actuator/health` | 健康检查（含 liveness / readiness） |

错误统一返回 JSON：`{timestamp, status, error, message, path}`。

## 用户与数据隔离

**注意：这不是身份认证。** 项目没有登录体系，`userId` 由前端在浏览器本地生成一个匿名 id
（`localStorage` 的 `spring-ai-test-user-id`）并随请求带上，后端所有查询都按它过滤：

- 不传 `userId` 的接口一律返回 400；
- 会话不属于该用户时返回 404，拿别人的 session id 也读不到内容。

这只能做到「按浏览器分区」，无法阻止别人伪造 `userId`。**如果要对外开放，必须先接入真正的
登录鉴权。**

> 升级提示：旧版本前端从不传 `userId`，历史数据都记在 `user_id='default'` 下。
> 前端做了兼容——本机若还留有旧版会话列表（`spring-ai-test-conversations`），会继续沿用
> `default`。如果换成新浏览器访问，需要手工把旧数据划过去：
>
> ```sql
> UPDATE chat_history SET user_id = '<新的 userId>' WHERE user_id = 'default';
> UPDATE conversation SET user_id = '<新的 userId>' WHERE user_id = 'default';
> ```

## 配置与密钥

所有敏感配置都通过环境变量注入，`application.yaml` 里不含任何明文密钥：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DB_URL` | `jdbc:mysql://localhost:3306/spring_ai_test?...` | 数据库连接串 |
| `DB_USERNAME` | `root` | 数据库用户名 |
| `DB_PASSWORD` | 空 | 数据库密码 |
| `DEEPSEEK_API_KEY` | 空 | **必填**，否则对话接口会返回鉴权失败 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek 接口地址 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 模型名 |
| `APP_CORS_ALLOWED_ORIGINS` | `*` | 允许的跨域来源，逗号分隔 |
| `CHAT_MAX_PROMPT_CHARS` | `4000` | 单条提问最大字符数 |
| `CHAT_CONTEXT_MAX_MESSAGES` | `20` | 送入模型的历史条数上限 |
| `CHAT_CONTEXT_MAX_CHARS` | `12000` | 送入模型的历史总字数上限 |
| `TTS_MAX_TEXT_CHARS` | `500` | 单次合成最大字符数 |
| `TTS_CACHE_MAX_ENTRIES` / `TTS_CACHE_MAX_BYTES` | `200` / `50MB` | 语音缓存上限 |
| `TTS_VOICE` / `TTS_RATE` | `zh-CN-XiaoxiaoNeural` / `0` | 音色与语速 |

其他：

- 角色提示词位于 `backend/src/main/resources/prompt/xilian.txt`，可自定义修改。
- 上下文窗口：长会话只会把最近 `CHAT_CONTEXT_MAX_MESSAGES` 条、且总字数不超过
  `CHAT_CONTEXT_MAX_CHARS` 的历史送给模型（最新一条永远保留）。系统提示词本身约 2700 tokens，
  不做限制会很快撞上模型上下文上限。

## 数据库与迁移

表结构由 **Flyway** 在应用启动时自动管理（`src/main/resources/db/migration/`），
不需要手工建表。只需先创建数据库：

```bash
mysql -u root -p < backend/src/main/resources/sql/chat_history.sql
```

对已存在的旧库，Flyway 会以 `baseline-version: 0` 接管，然后补齐缺失的迁移（如
`V2__create_conversation.sql` 会新建 `conversation` 表并回填已有会话）。

> 环境说明：Flyway 11 会提示 "Using MySQL 9.5 which is newer than the version Flyway has been
> verified with (8.1)"，这只是警告，实测可正常迁移。

## Docker 部署

```bash
export DEEPSEEK_API_KEY=sk-xxxx
export DB_ROOT_PASSWORD=一个强密码
docker compose up -d --build
```

会起三个容器：`mysql` + `backend`（多阶段构建的 jar）+ `nginx`（托管前端 `dist` 并反代 `/api`）。
访问 `http://<服务器IP>/` 即可，表结构由后端启动时的 Flyway 自动创建。

改端口用 `HTTP_PORT=8080 docker compose up -d`。后端以非 root 用户运行，并带
`/actuator/health` 健康检查。

## 生产部署提示

- 前端必须用 `npm run build` 产出静态文件，**不要用 Vite dev server 上生产**；
  `vite.config.js` 里的 `/api` 代理只在开发期生效，生产需要由 Nginx 等反向代理补齐
  （`deploy/nginx.conf` 已提供，注意其中关闭了 `proxy_buffering`，否则 SSE 打字机效果会失效）。
- 若由 Nginx 同域托管前端并反代 `/api`，本身不存在跨域问题，可把
  `APP_CORS_ALLOWED_ORIGINS` 收紧到具体域名。
- 生产环境请用 `--spring.profiles.active=prod`：它会把日志从 `debug` 收紧到 `info`。
  默认配置下 `SimpleLoggerAdvisor` 会把整段 prompt（含几万字的系统提示词）打进日志。
- TTS 通过后端与微软 Edge TTS 建立 WebSocket 连接（`speech.platform.bing.com:443`），
  **需要服务器能出网访问该地址**；部分机房/地区会被阻断，届时语音功能不可用，但不影响文字对话。
- 生产环境不要使用 `root` 连接数据库，建议建专用账号。

## 注意事项

- 聊天记录只存 MySQL，读取路径也是 MySQL。
- 请勿将真实 API Key 提交到版本库；本项目已通过 `.gitignore` 忽略 `.env`。

## License

仅供学习交流使用。
