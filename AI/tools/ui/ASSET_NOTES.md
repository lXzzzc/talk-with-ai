# 昔涟界面素材

## 通话窗口装饰 v1

- 新增 `AI/public/xilian-call-avatar-frame-v1.png`，复用趴窗昔涟与气泡花饰；用途和完整内置 image_gen 提示词见 `CALL_ASSET_NOTES.md`。

## 聊天气泡装饰 v1（已停用）

- 文件：`AI/public/xilian-bubble-corner-v1.png`。
- 保留玫瑰、渐变羽饰和短缎带边角素材，正式聊天界面已按用户要求停用花饰、装饰线和内层边框。
- 内置 image_gen，透明背景；参考昔涟 Q 版图和原花饰，完整生成提示词保存在 `AI/design-previews/chat-shell-v1/ASSET_NOTES.md`。
- 正文是自适应的真实 HTML；双方气泡使用简洁样式。

## 确认弹窗人物

- 文件：`AI/public/xilian-dialog-perch-v1.png`
- 制作方式：内置 image_gen，透明背景，参考 `AI/public/xilian-pet-standing.png`。
- 使用位置：`AI/src/XilianDialogFrame.vue`，复用于打开软件和查看窗口的确认卡片。
- 保留原有服饰与角色特征，仅制作趴在窗口边缘、下巴轻靠手臂的姿势。
- 原始生成结果保留在 Codex generated_images 中，项目使用独立副本。

## 最终生成提示词

Use case: identity-preserve. Asset type: transparent PNG character ornament for the upper edge of a real software confirmation dialog, not a UI mockup. Input image: the provided local xilian-pet-standing.png is the character identity and costume reference. Depict exactly this same gentle chibi Xilian, preserving her pink hair with lavender and pale cyan ends, violet diamond-highlight eyes, pointed ears, the exact lavender rose and iridescent wing-shaped hair ornament, white and purple fantasy costume including its existing ruffles, gloves/cuffs, ribbons and trims. Change only her pose and expression: she is leaning forward, comfortably lying on her stomach behind an INVISIBLE horizontal window edge, facing the viewer, with her chin gently resting on her two folded forearms and her little hands draping slightly over that invisible edge. Friendly soft closed-mouth smile and relaxed shoulders. The head is upright, very slightly tilted, not sleeping. Show her head, flowing side hair, shoulders, sleeves, folded forearms and hands; the lower torso is naturally behind the invisible ledge, with no abrupt white rectangle or drawn ledge. A compact horizontally balanced bust ornament, both elbows and all head ornaments fully visible with transparent margin. The virtual support line is near the bottom 15 percent of the asset, so her hands can visually hang over a card border when composited. Preserve the reference's clean polished 2D anime sticker rendering, purple linework and soft pastel shading. Genuine transparent alpha background. Only one character. Do not draw a window, border, desk, card, pillow, text, logo, flowers around her, background, checkerboard, sparkle effects, floor shadow, halo, or opaque color blocks. Costume colors and accessories must not change. The ornament must work at 180px wide in a web interface.
