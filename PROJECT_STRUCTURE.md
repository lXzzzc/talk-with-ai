# 项目目录与版本管理

- `AI/src/`：Vue 界面、独立桌宠、动态壁纸和语音状态代码。
- `AI/electron/`：桌面主进程、预加载、安全接口及桌面生命周期测试。
- `AI/public/pets/xilian-video-v2/`：当前七段透明桌宠动画。
- `AI/public/wallpapers/xilian-workshop-3593357539/`：当前 Spine 动态壁纸、纹理及 2560×1440 高清启动首帧。
- `AI/scripts/`：前端和 Electron 开发、打包脚本。
- `AI/tools/pet-video/`：桌宠素材导入、透明度检查及桌面启动验证工具。
- `AI/tools/wallpaper/`：高清首帧导出、壁纸运行验证及帧率测量工具。
- `AI/reports/`：本机测试数据、截图和验证结果，不进入发布包或 Git。
- `AI/dist/`：自动生成的前端发布资源，不手工编辑。
- `backend/`：Spring AI 后端服务。
- `agent-tool-server/`：本机工具服务。
- `deploy/`：服务部署配置。
- `releases/0.4.4/`：当前 Windows 安装包、免安装 EXE 和解包后的应用目录。
- `releases/history/`：旧的发布产物及更新前已安装版本备份。
- `archive/development-2026-10-23/`：旧桌宠生成实验、Live2D 设计过程文件、临时 Pixi 环境和旧版素材。

`AI/src/live2d/` 仍保留：语音代码引用其中的音频分析工具。`AI/public/live2d/` 也保留作兼容资源，未因整理而删除功能依赖。

## 用户启动入口

普通用户使用桌面的「昔涟 AI」快捷方式，指向安装后的 GUI EXE；无需 Node.js、Steam、DSH 或脚本窗口。免安装版位于 `releases/0.4.4/XilianAI-0.4.4-x64-portable.exe`。

开发者才使用 `AI/start-desktop.vbs` 或 `npm run desktop`。Windows 安装包通过 `cd AI` 后运行 `npm run desktop:electron:build` 生成。重复构建同一版本时会把旧产物移至 `releases/history/`，不覆盖用户聊天记录和配置。

## 本次修复

启动背景改为真实渲染的高清首帧，并验证其图像内容；动画绘制完成后再切换，不放大低分辨率 GIF。保持 GPU 加速和背景像素预算。NSIS 输出目录在构建前设置正确的完整性标签，并使用专用可写临时目录，避免中间程序无法创建临时文件。

0.4.0 新增 `AI/src/PetChat.vue` 气泡对话与 `AI/src/SplashScreen.vue` 涟漪开屏。`AI/src/petActivity.js` 同步主界面、气泡和通话的倾听/等待状态；`AI/src/petSpeech.js` 继续同步实际语音播放。`AI/electron/pet-geometry.cjs` 处理拖动阈值、多显示器边界与气泡跟随。桌面服务端口写入用户目录并在重启时复用，以保留同源本地会话状态。

0.4.1 新增 `AI/src/XilianDialogFrame.vue` 和 `AI/public/xilian-dialog-perch-v1.png`，用于确认弹窗的趴窗人物及花瓣涟漪装饰。`AI/tools/ui/` 保存生成提示词、独立模拟桥接与视觉验证工具，`AI/reports/dialog/` 保存本机验证截图。

0.4.2 将已确认的聊天设计接入 `AI/src/App.vue` 与 `AI/src/chatShell.css`：内容高度浮动侧栏、记住桌面收起状态、窄屏抽屉、居中输入区和玫瑰羽饰气泡。装饰素材为 `AI/public/xilian-bubble-corner-v1.png`。`AI/design-previews/chat-shell-v1/` 保留设计原型；`AI/tools/ui/chat-shell-fixture.cjs` 提供隔离的模拟会话，`AI/reports/chat-shell/` 保存正式构建的验证截图。

0.4.3 将桌宠与气泡默认设为高层置顶，在显示、恢复或主界面获取焦点后重新排列窗口，气泡位于桌宠上方；重新置顶不获取输入焦点。对隐藏启动器导致首次显示失效的情况补一次异步显示。

0.4.4 为 `AI/src/VoiceCall.vue` 增加玫瑰羽饰头像框、趴窗昔涟字幕卡片、淡花饰与涟漪背景。新素材为 `AI/public/xilian-call-avatar-frame-v1.png`，完整生成提示词见 `AI/tools/ui/CALL_ASSET_NOTES.md`；实际构建截图位于 `AI/reports/voice-call-design/`。装饰不接收点击，通话与字幕逻辑沿用现有实现，短窗口内可滚动到控件。
