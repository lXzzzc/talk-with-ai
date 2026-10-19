# Talk with AI

一个基于 **Spring AI + Vue 3** 的 AI 对话应用，集成 DeepSeek 大模型对话、MySQL 聊天记录持久化，并通过**本地部署的 IndexTTS** 实现语音合成播放。

## 技术栈

**前端（`AI/`）**
- Vue 3 + Vite
- 流式对话（SSE）
- Markdown 渲染（marked + DOMPurify 消毒）
- TTS 语音播报（调用后端代理）

**后端（`backend/`）**
- Spring Boot 4（Java 21）
- Spring AI 2.0（DeepSeek Chat Model）
- MySQL + MyBatis（聊天记录持久化）
- Flyway（数据库版本管理）
- Actuator（健康检查）
- TTS：HTTP 调用后端代理的阿里云 Voice Studio 实时语音合成

> 聊天记录以 **MySQL 为唯一事实来源**：前端回显和拼装大模型上下文都从数据库读取，
> 不再依赖 Redis 或 Spring AI 的内存 ChatMemory，因此进程重启后对话上下文依然连续。

## 项目结构

```
talk with ai/
├── AI/                      # 前端（Vue 3 + Vite）
│   ├── src/
│   │   ├── App.vue          # 聊天主界面
│   │   ├── tts.js           # TTS 客户端封装
│   │   ├── main.js
│   │   └── styles.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.js       # 开发期把 /api 代理到后端 8080
├── backend/                 # 后端（Spring Boot）
│   ├── .env.example         # 密钥模板（复制为 .env，已被 gitignore）
│   └── src/main/
│       ├── java/org/xzzz/
│       │   ├── config/      # ChatClient、跨域、提示词读取
│       │   ├── controller/  # Chat / ChatHistory / TTS 接口
│       │   ├── service/     # 对话服务、聊天记录读写、TTS
│       │   ├── mapper/      # MyBatis Mapper
│       │   └── entity/      # 实体类与 VO
│       └── resources/
│           ├── application.yaml
│           ├── prompt/xilian.txt   # 角色提示词
│           └── sql/chat_history.sql
└── agent-tool-server/       # 本地 Windows MCP 工具服务（默认只读）
```

## 功能特性

- 多会话对话管理（新建 / 切换 / **重命名 / 删除**）
- SSE 流式输出，打字机效果
- DeepSeek 大模型对话，上下文跨进程重启保持
- AI 回复按 Markdown 渲染（代码块、列表、表格等）
- 聊天记录持久化到 MySQL，前端会话列表从数据库读取
- 按用户隔离的会话数据（匿名 userId，见下文说明）
- 阿里云 Voice Studio 语音播报（可开关、排队播放、结果带 LRU 缓存）
- 桌面端按住说话：松开后用 Qwen3-ASR 转文字，自动提问并朗读 AI 回复
- 桌面端窗口理解：截取前台窗口、本地预览确认，再由 DeepSeek V4.1 Flash 分析图片
- 当地天气查询（城市搜索 / 浏览器定位）、3 天预报与出行穿衣建议
- 桌面端本地命令：发现当前电脑已安装的软件，确认后安全启动
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
| POST | `/ai/tts` | **推荐**。Body: `{text}`，返回 `audio/wav` |
| POST | `/ai/asr` | multipart `audio`，返回语音识别文本 |
| POST | `/ai/vision` | multipart `image` + `userId` / `conversationId` / `question` / `windowTitle` |
| GET | `/ai/tts?text=...` | 兼容旧调用方，长文本请改用 POST |
| GET | `/actuator/health` | 健康检查（含 liveness / readiness） |
| GET | `/weather?city=杭州` | 按城市查询当前天气、3 天预报和建议 |
| GET | `/weather?latitude=30.3&longitude=120.2` | 按坐标查询天气（前端“使用我的位置”） |

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
| `TTS_MAX_TEXT_CHARS` | `5000` | 单次合成最大字符数 |
| `TTS_CACHE_MAX_ENTRIES` / `TTS_CACHE_MAX_BYTES` | `200` / `50MB` | 语音缓存上限 |
| `TTS_ALIYUN_API_KEY` | 空 | **必填**，Voice Studio API Key |
| `TTS_ALIYUN_VOICE_ID` | 空 | **必填**，Voice Studio 音色 ID |
| `TTS_ALIYUN_ENDPOINT` | `wss://convai-platform.aliyuncs.com/api-ws/v1/inference` | 实时合成 WebSocket 地址 |
| `DASHSCOPE_API_KEY` | 空 | **必填**，服务端调用 Qwen3-ASR |
| `DASHSCOPE_CHAT_URL` | 阿里云百炼 OpenAI 兼容地址 | 语音识别网关 |
| `VISION_DEEPSEEK_MODEL` | `deepseek-flash` | 截图理解模型，当前对应 DeepSeek V4.1 Flash |
| `ASR_ALIYUN_MODEL` | `qwen3-asr-flash` | 语音识别模型 |
| `WEATHER_GEOCODING_URL` | Open-Meteo Geocoding API | 城市搜索服务地址，通常无需修改 |
| `WEATHER_FORECAST_URL` | Open-Meteo Forecast API | 天气预报服务地址，通常无需修改 |

其他：

- 角色提示词位于 `backend/src/main/resources/prompt/xilian.txt`，可自定义修改。
- 天气功能使用 Open-Meteo，不需要额外 API Key；服务器需要能够访问其 API 域名。
- 上下文窗口：长会话只会把最近 `CHAT_CONTEXT_MAX_MESSAGES` 条、且总字数不超过
  `CHAT_CONTEXT_MAX_CHARS` 的历史送给模型（最新一条永远保留）。系统提示词本身约 2700 tokens，
  不做限制会很快撞上模型上下文上限。

## 语音合成（阿里云 Voice Studio）

后端使用 `com.aliyun.convai:convai-voice-sdk:0.1.0` 连接 Voice Studio 实时 WebSocket，
按音色 ID 合成 WAV 音频。把 `TTS_ALIYUN_API_KEY` 和 `TTS_ALIYUN_VOICE_ID` 写入本地 `.env` 后重启后端即可。

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

> 📘 **完整的上服务器步骤见 [`DEPLOY.md`](DEPLOY.md)**（服务器要求、装 Docker、配密钥、
> 启动验证、日常运维、备份、域名 HTTPS、常见问题排查）。

```bash
cp .env.example .env      # 填好 DB_ROOT_PASSWORD / DB_PASSWORD / DEEPSEEK_API_KEY
docker compose up -d --build
```

会起三个容器：`mysql` + `backend`（多阶段构建的 jar）+ `nginx`（托管前端 `dist` 并反代 `/api`）。
访问 `http://<服务器IP>/` 即可，表结构由后端启动时的 Flyway 自动创建。

应用使用独立数据库账号 `talkai`（只对 `spring_ai_test` 库有权限），而不是 root。
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
- TTS 使用阿里云 Voice Studio，容器部署时请通过环境变量注入 `TTS_ALIYUN_API_KEY` 和
  `TTS_ALIYUN_VOICE_ID`，不要把密钥写入镜像或提交到仓库。前端按句朗读并带缓存，
  所以首句会有等待感，属正常现象。
- 生产环境不要使用 `root` 连接数据库，建议建专用账号。

## 注意事项

- 聊天记录只存 MySQL，读取路径也是 MySQL。
- 请勿将真实 API Key 提交到版本库；本项目已通过 `.gitignore` 忽略 `.env`。

## 本地 Agent 电脑工具

`agent-tool-server/` 提供一个 Windows 本地 MCP 服务，包含窗口枚举、屏幕截图、鼠标位置以及
受权限开关保护的打开应用、打开网址、点击和输入工具。默认注册为只读，具体安装、安全边界和
写权限开启方式见 [`agent-tool-server/README.md`](agent-tool-server/README.md)。

## Windows 桌面客户端

前端已接入 Tauri 2，可继续作为网站运行，也可以构建 Windows NSIS 安装包。桌面版默认连接
`http://101.35.54.118`；构建其他环境时通过 `TALK_AI_DESKTOP_API_URL` 覆盖，密钥仍只保留在服务端。

```powershell
cd AI
npm install
$env:TALK_AI_DESKTOP_API_URL = 'https://你的域名'
npm run desktop:build
```

安装包输出到 `AI/src-tauri/target/release/bundle/nsis/`。关闭主窗口时应用会隐藏到系统托盘，
托盘菜单可以重新显示或彻底退出；重复启动会激活已有窗口。

本地调试桌面版可运行 `npm run desktop:dev`。它默认连接已部署服务器；同时在浏览器打开
`http://localhost:5173` 时，请求会通过 Vite 同源代理转发，不会把 localhost 的 Origin 发送给服务器。

### 打开本地软件

桌面客户端支持 `/打开 计算器`、“帮我打开记事本”或“打开微信”这类命令。它会从当前电脑的
开始菜单、Windows 注册表和系统 PATH 中检索软件，并把目录缓存到
`%LOCALAPPDATA%\com.xzzz.talkwithai\applications.json`。缓存没有命中时会自动重新扫描；仍然
找不到时，可以手动选择 `.exe` 或 `.lnk`，该映射只保存在当前电脑。

发现多个同名软件时需要先选择，所有软件都只有在用户确认后才会启动。启动逻辑只接受本机目录
生成的软件 ID，不会执行聊天中的路径、参数、Shell、CMD 或 PowerShell 内容。网页版不会执行
本地软件命令。启动成功后，客户端只把软件显示名称和“启动成功”事件作为对话上下文发送给
服务端，让 AI 按角色自然回应；不会上传安装路径，也不会让 AI 假装看到了软件中的窗口或文件。

### 窗口截图理解与按住说话

桌面端标题栏的相机按钮会临时隐藏自身，再截取当时位于前台的 Windows 窗口。截图先留在
本机预览，只有点击“发送并分析”后才上传；上传前应主动检查账号、密钥等敏感信息。第一阶段
仅支持 Windows，并且只截取单个前台窗口，不会持续录屏。

输入框旁的麦克风按钮支持鼠标或触控“按住说话、松开发送”，最长录制 60 秒。客户端仅把
本次录音上传到 `/api/ai/asr` 转写，识别文本会沿用普通对话链路发送，AI 回复则沿用现有 TTS
自动朗读。首次使用需要允许麦克风权限；网页端使用麦克风时必须运行在 HTTPS 或 localhost。

截图理解复用已有的 `DEEPSEEK_API_KEY`，语音识别需要 `DASHSCOPE_API_KEY`；两个密钥都只在
服务端使用，不会进入前端或安装包。Nginx 需要将 `client_max_body_size` 设为至少 `12m`，
仓库中的部署配置已经包含该限制。

### 实时语音通话（本地）

聊天页右上角的电话按钮会打开独立通话窗口，点击“开始通话”后使用麦克风。
支持实时字幕、停顿自动回答、边合成边播放、说话或按钮打断、静音和再次拨打。
桌面端是独立系统窗口；浏览器版使用弹出窗口，需允许该站点弹窗。
关闭通话窗口或挂断会释放麦克风、识别连接和当前生成任务。默认不保存原始录音；
只有播放器确认播放完的句子进入后续聊天记忆，打断的回复会有标记。

后端使用已有 `DASHSCOPE_API_KEY` 调用 `qwen3-asr-flash-realtime`，
沿用 DeepSeek、人设、天气地点与 Voice Studio 音色，仍需联网。
`VOICE_ASR_URL` 留空时沿用 `DASHSCOPE_CHAT_URL` 的业务空间域名；
也可以显式配置不带查询参数的 `wss://.../api-ws/v1/realtime`。
本地入口是 `/voice/realtime`，Vite 的 `/api` 代理已经开启 WebSocket 转发。
默认只接受本机开发和 Tauri 来源，并限制并发、音频速率和通话时长。

同时启动本地后端后，桌面本地调试使用：

```powershell
cd AI
npm run desktop:dev -- --local
```

该模式通过本机 Vite 访问 `localhost:8080`，不要另外重复启动占用 5173 的 Vite 进程。
若将来部署公网，需要为 Nginx 配置 WebSocket Upgrade 转发、HTTPS/WSS、
实际站点的 `VOICE_ALLOWED_ORIGINS`，并接入真实用户鉴权；当前改动仅在本机运行验证。

### 桌面端服务器连接

桌面构建会把 `TALK_AI_DESKTOP_API_URL` 注入为 API 根地址。跨域请求通过 Tauri 原生 HTTP
插件发送，并把 `Origin` 规范化为目标服务器自身来源，避免 WebView 的 `tauri.localhost`
被服务端 CORS 拦截；默认允许 `http://101.35.54.118`，自定义服务器建议使用
HTTPS，并需要按上面的命令重新构建安装包。

## License

仅供学习交流使用。
