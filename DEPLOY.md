# 部署到服务器

本文档是从零把项目跑在你自己的服务器上的完整步骤。推荐用 **Docker Compose**，一条命令起 MySQL + 后端 + Nginx。

---

## 0. 架构

```
                 ┌──────────────────────────────────────────┐
   浏览器  ──▶   │  nginx 容器 (80)                          │
   http://IP/    │    /            → 前端静态文件 dist        │
                 │    /api/...     → 反代 backend:8080 (去掉 /api) │
                 └───────────────┬──────────────────────────┘
                                 │
                 ┌───────────────▼──────────────────────────┐
                 │  backend 容器 (Spring Boot, 8080)          │
                 │    出网 → api.deepseek.com   (对话/识图)   │
                 │    出网 → 阿里云百炼          (语音识别)   │
                 │    WSS → 阿里云 Voice Studio       (TTS)   │
                 └───────────────┬──────────────────────────┘
                                 │
                 ┌───────────────▼──────────────────────────┐
                 │  mysql 容器 (8.4)  volume: mysql-data      │
                 │    表结构由后端启动时 Flyway 自动创建        │
                 └──────────────────────────────────────────┘
```

只有 nginx 对外暴露端口，MySQL 和后端都在 Docker 内网里，不对外。

---

## 1. 服务器要求

| 项 | 最低 | 建议 |
| --- | --- | --- |
| CPU / 内存 | 1 核 2G | 2 核 4G |
| 磁盘 | 10G | 20G+（MySQL 数据 + 镜像） |
| 系统 | 任何能装 Docker 的 Linux | Ubuntu 22.04 / Debian 12 |
| 出网 | 必须能访问 `api.deepseek.com`、`convai-platform.aliyuncs.com:443` | — |
| 开放端口 | 80（或你自定义的 `HTTP_PORT`） | 80 + 443 |

> `convai-platform.aliyuncs.com:443` 是阿里云语音合成用的。网络不通时不影响文字对话，只是朗读按钮不可用。

---

## 2. 把代码放到服务器

### 方式 A：从 GitHub 拉（推荐）

先确认本地代码已推到 GitHub（见 README / 上一步的推送）。

```bash
# 服务器上
sudo mkdir -p /opt && cd /opt
git clone https://github.com/lXzzzc/talk-with-ai.git
cd talk-with-ai
```

> 国内服务器直连 GitHub 常常失败，可以用：
> - 给 git 配代理：`git config --global http.proxy http://<你的代理>:7890`
> - 或使用加速镜像（如 `https://ghproxy.net/https://github.com/...`）
> - 或在本地打包后 scp 上传（方式 B）

### 方式 B：本地打包上传

```powershell
# 本地（Windows）
cd "C:\Users\Xzzz\source\repos\talk with ai"
git archive -o ..\talk-with-ai.zip HEAD
scp ..\talk-with-ai.zip user@<服务器IP>:/opt/
```

```bash
# 服务器
cd /opt && unzip talk-with-ai.zip -d talk-with-ai && cd talk-with-ai
```

---

## 3. 安装 Docker

```bash
# 官方脚本（国内可能慢，见下方镜像加速）
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker

# 验证
docker --version
docker compose version
```

如果 `get.docker.com` 拉不动，用国内镜像装：

```bash
curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg | sudo apt-key add -
# 或直接用系统包管理器
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
```

**配置镜像加速（国内必做，否则拉不到 mysql/nginx/node 等基础镜像）**：

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://dockerproxy.com",
    "https://mirror.ccs.tencentyun.com"
  ]
}
EOF
sudo systemctl restart docker
```

---

## 4. 配置密钥

```bash
cd /opt/talk-with-ai
cp .env.example .env
vim .env          # 或 nano .env
```

必填密钥：

```properties
DB_ROOT_PASSWORD=一个强密码          # MySQL root，仅容器内部使用
DB_PASSWORD=另一个强密码             # 应用账号 talkai 的密码
DEEPSEEK_API_KEY=sk-你的真实key
TTS_ALIYUN_API_KEY=sk-你的 Voice Studio key
TTS_ALIYUN_VOICE_ID=你的音色ID
DASHSCOPE_API_KEY=sk-你的百炼key
```

可选：

```properties
HTTP_PORT=80                                  # 对外端口
MAVEN_MIRROR_URL=https://maven.aliyun.com/repository/public   # 国内构建加速
NPM_REGISTRY=https://registry.npmmirror.com                   # 国内构建加速
```

> `.env` 已被 `.gitignore` 忽略，**不会**被提交。权限收紧一下更稳妥：
> `chmod 600 .env`

---

## 5. 启动

```bash
docker compose up -d --build
```

首次构建要下载基础镜像 + Maven/npm 依赖，**5～20 分钟**属正常。加 `-d` 后可以看进度：

```bash
docker compose logs -f backend
```

启动顺序由 compose 控制：MySQL 健康检查通过 → 后端启动 → 后端跑 Flyway 建表 → Nginx 可用。

---

## 6. 验证

```bash
# 1) 三个容器都应是 Up，mysql 是 healthy
docker compose ps

# 2) 后端健康检查
curl -s http://127.0.0.1/healthz
# 期望：{"groups":["liveness","readiness"],"status":"UP"}

# 3) 前端页面
curl -sI http://127.0.0.1/ | head -1     # 期望 HTTP/1.1 200 OK

# 4) 接口连通（返回 [] 说明数据库通了）
curl -s "http://127.0.0.1/api/getChatIds?userId=deploy-test"
```

然后浏览器打开 `http://<服务器IP>/`，发一条消息确认：
- 文字能流式输出（有打字机效果）
- 刷新页面后历史记录还在（MySQL 持久化生效）

> 如果 3) 返回 502，通常是后端还在启动（首次要跑 Flyway 建表），
> 等 30 秒再试，或看 `docker compose logs backend`。

---

## 7. 日常运维

```bash
# 看日志
docker compose logs -f backend
docker compose logs -f nginx

# 重启
docker compose restart backend

# 停止（保留数据）
docker compose down

# 停止并删除数据卷 ⚠️ 聊天记录会全没
docker compose down -v

# 更新代码后重新部署
git pull
docker compose up -d --build

# 只重建前端（改了 AI/ 下的东西）
docker compose build nginx && docker compose up -d nginx
```

### 备份数据库

```bash
# 备份
docker compose exec -T mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" spring_ai_test' \
  > backup-$(date +%F).sql

# 恢复
cat backup-2026-01-01.sql | docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" spring_ai_test'
```

建议加进 crontab：

```cron
0 3 * * * cd /opt/talk-with-ai && docker compose exec -T mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" spring_ai_test' > /opt/backup-$(date +\%F).sql
```

---

## 8. 绑定域名 + HTTPS（可选）

最省事的做法是用 Caddy 自动签证书。让项目自己的 Nginx 退到一个内部端口：

```properties
# .env
HTTP_PORT=8080
```

```bash
# 装 Caddy 后，/etc/caddy/Caddyfile
你的域名.com {
    reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo systemctl reload caddy
```

Caddy 会自动申请并续期 Let's Encrypt 证书，同时把 SSE 流正常透传（它默认不缓冲）。

> 前提：域名 A 记录已指向服务器 IP，且 80/443 放行。

---

## 9. 常见问题

### 后端起不来：`Public Key Retrieval is not allowed`

MySQL 8 默认认证插件是 `caching_sha2_password`，在 `useSSL=false` 时驱动必须能向服务端索取 RSA 公钥。

**本项目已在三处默认带上 `allowPublicKeyRetrieval=true`**（`docker-compose.yml`、`application.yaml`、`backend/.env.example`）。
如果你自己改过 `DB_URL`，务必保留这个参数：

```
jdbc:mysql://mysql:3306/spring_ai_test?...&useSSL=false&allowPublicKeyRetrieval=true&...
```

### 打字机效果没了 / 回复一次性蹦出来

Nginx 的 `proxy_buffering` 必须为 `off`。`deploy/nginx.conf` 里已经配好，
如果你在 Caddy/Nginx 前面又加了一层代理，那一层也要关缓冲。

### 语音朗读不可用

后端需要能出网访问 `convai-platform.aliyuncs.com:443`。在服务器上测：

```bash
docker compose exec backend sh -c 'curl -sI https://convai-platform.aliyuncs.com | head -1'
```

不通就是机房/地区被阻断，**不影响文字对话**。

### 构建特别慢或卡住

1. 配好 Docker 镜像加速（见第 3 步）
2. `.env` 里打开 `MAVEN_MIRROR_URL` 和 `NPM_REGISTRY`
3. 还不行就在本地构建好镜像再传：

   ```powershell
   # 本地（需要 Docker Desktop 运行中）
   docker compose build
   docker save talk-with-ai-backend talk-with-ai-nginx -o images.tar
   scp images.tar user@<服务器IP>:/opt/
   ```
   ```bash
   # 服务器
   docker load -i images.tar
   docker compose up -d
   ```

### 页面能开但接口 502

后端还没起来或已经崩溃：

```bash
docker compose ps
docker compose logs --tail=100 backend
```

首次启动要跑 Flyway 建表，等 30 秒属正常。

### 内存不够（容器被 OOM Kill）

`JAVA_OPTS` 默认按容器内存的 75% 给堆。1 核 2G 的机器同时跑 MySQL + JVM 会很紧，
建议在 `.env` 里显式限制：

```properties
JAVA_OPTS=-Xmx512m -XX:MaxRAMPercentage=60
```

### 80 端口被占用

```properties
# .env
HTTP_PORT=8080
```

然后访问 `http://<服务器IP>:8080/`。

---

## 10. 不用 Docker 的部署方式

如果服务器不方便装 Docker：

```bash
# 1) 数据库：自己装 MySQL 8 并建库
mysql -u root -p -e "CREATE DATABASE spring_ai_test DEFAULT CHARSET utf8mb4;"

# 2) 后端：本地 mvn clean package -DskipTests 打出 jar，上传后运行
export SPRING_PROFILES_ACTIVE=prod
export DB_USERNAME=root DB_PASSWORD=xxx
export DB_URL='jdbc:mysql://127.0.0.1:3306/spring_ai_test?useUnicode=true&characterEncoding=utf8&useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=Asia/Shanghai'
export DEEPSEEK_API_KEY=sk-xxx
java -XX:MaxRAMPercentage=75 -jar spring-ai-test-0.0.1-SNAPSHOT.jar

# 3) 前端：本地 npm run build，把 dist/ 丢给 Nginx
#    Nginx 配置直接抄 deploy/nginx.conf，把 proxy_pass 的 backend:8080 换成 127.0.0.1:8080
```

建议配 systemd 让它开机自启：

```ini
# /etc/systemd/system/talk-with-ai.service
[Unit]
Description=Talk with AI backend
After=network.target mysql.service

[Service]
User=www-data
WorkingDirectory=/opt/talk-with-ai
EnvironmentFile=/opt/talk-with-ai/backend.env
ExecStart=/usr/bin/java -XX:MaxRAMPercentage=75 -jar /opt/talk-with-ai/app.jar
Restart=always

[Install]
WantedBy=multi-user.target
```

---

## 11. 上线前的安全检查清单

- [ ] `DEEPSEEK_API_KEY` 是**新申请的**，旧 key 已在控制台吊销
- [ ] `DB_ROOT_PASSWORD` / `DB_PASSWORD` 不是弱密码
- [ ] `.env` 权限为 `600`，且确认没有被提交到 Git
- [ ] 数据库不暴露公网（本项目 compose 默认就不暴露）
- [ ] 配了 HTTPS（否则 API Key 和聊天内容在公网上是明文）
- [ ] `APP_CORS_ALLOWED_ORIGINS` 收紧成你的域名（同域部署可保持 `*`）
- [ ] 数据库有定时备份
- [ ] 防火墙只放行必要端口（80/443，或你的 `HTTP_PORT`）

> ⚠️ 本项目**没有登录体系**：`userId` 是前端在浏览器本地生成的匿名 id，
> 只能做到「按浏览器分区」，无法阻止别人伪造。**对外开放前请先接入真正的登录鉴权。**
