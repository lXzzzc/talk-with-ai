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
- `releases/0.3.0/`：当前 Windows 安装包、免安装 EXE 和解包后的应用目录。
- `releases/history/`：旧的发布产物及更新前已安装版本备份。
- `archive/development-2026-10-23/`：旧桌宠生成实验、Live2D 设计过程文件、临时 Pixi 环境和旧版素材。

`AI/src/live2d/` 仍保留：语音代码引用其中的音频分析工具。`AI/public/live2d/` 也保留作兼容资源，未因整理而删除功能依赖。

## 用户启动入口

普通用户使用桌面的「昔涟 AI」快捷方式，指向安装后的 GUI EXE；无需 Node.js、Steam、DSH 或脚本窗口。免安装版位于 `releases/0.3.0/XilianAI-0.3.0-x64-portable.exe`。

开发者才使用 `AI/start-desktop.vbs` 或 `npm run desktop`。Windows 安装包通过 `cd AI` 后运行 `npm run desktop:electron:build` 生成。重复构建同一版本时会把旧产物移至 `releases/history/`，不覆盖用户聊天记录和配置。

## 本次修复

启动背景改为真实渲染的高清首帧，并验证其图像内容；动画绘制完成后再切换，不放大低分辨率 GIF。保持 GPU 加速和背景像素预算。NSIS 输出目录在构建前设置正确的完整性标签，并使用专用可写临时目录，避免中间程序无法创建临时文件。
