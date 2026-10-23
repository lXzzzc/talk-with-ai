# Live2D 前端骨架

> 状态：**代码骨架已写好，但尚未接入页面**。
> 原因：模型还没有从 Cubism 导出（P3），且当前网络无法稳定安装 `pixi.js` 依赖。
> 目标：依赖和 `model3.json` 就绪后，只改一个开关 + 三处模板即可接入。

## 文件

| 文件 | 作用 |
|---|---|
| `Live2DStage.vue` | 舞台组件：加载 Core、创建 Pixi Application、加载模型、缩放/居中、口型、表情、热区、暂停、销毁、静态回退 |
| `live2dConfig.js` | 模型/Core 路径、动作名、表情名、热区映射、`LIVE2D_ENABLED` 开关 |
| `audioLevel.js` | TTS/通话用的 RMS、噪声门、平滑、口型驱动 |

`Live2DStage.vue` 使用**动态 import**，只有启用时才会加载 Pixi 和引擎；当前没有被任何页面引用，所以不会影响现有构建。

## 依赖

```bash
npm install pixi.js@8.13.1 @pixi/sound@6.0.1 untitled-pixi-live2d-engine@1.2.2
```

- `pixi.js` 8.x
- `@pixi/sound` 6.x（引擎 peer dependency）
- `untitled-pixi-live2d-engine` 1.2.2（Cubism 2–5，Pixi 8）

## 启用步骤

1. 把 Cubism 导出的模型放到 `AI/public/live2d/xilian/`。
2. 从 Cubism SDK for Web 5.3 取 `Core/live2dcubismcore.min.js`，放到 `AI/public/live2d/core/`。
3. 安装上面的依赖。
4. 把 `live2dConfig.js` 的 `LIVE2D_ENABLED` 改为 `true`。
5. 在页面里引入组件：

```vue
<script setup>
import Live2DStage from './live2d/Live2DStage.vue'
</script>

<Live2DStage
  :mouth="mouthLevel"
  mood="smile"
  :interactive="true"
  :follow-pointer="true"
  @ready="onReady"
  @error="onError"
  @hit="onHit"
/>
```

6. 先接聊天首页 `.hero-visual`，再接通话页，最后接桌宠（桌宠需要处理 `-webkit-app-region: drag` 与画布点击冲突）。

## 口型

`Live2DStage` 每帧在低优先级 ticker 里写 `ParamMouthOpenY`，避免被动作覆盖。

- 聊天 TTS：在 `tts.js` 的 `playBlob` 里创建 `AudioContext` + `MediaElementSource` + `AnalyserNode`，用 `audioLevel.js` 的 `createMouthDriver()` 读电平，把值传给 `:mouth`。
- 实时通话：在 `realtimeVoice.js` 的 `PcmPlayer` 输出 `gain` 后接 `AnalyserNode`，把 AI 输出电平（不是麦克风电平）传给 `:mouth`。

## 注意

- `live2dcubismcore.min.js` 是 Live2D 专有运行时，随应用打包并保留 LICENSE，不要公开再分发。
- 当前 `LIVE2D_ENABLED = false`，组件会直接显示静态图，不会加载 WebGL。
- 依赖安装成功前，不要把 `Live2DStage.vue` 引入任何页面，否则 Vite 会因找不到 `pixi.js` 而构建失败。
