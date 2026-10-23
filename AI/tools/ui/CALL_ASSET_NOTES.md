# 昔涟通话窗口装饰素材 v1

- 生成方式：内置 image_gen，参考素材生成，真正透明背景。
- 新素材：AI/public/xilian-call-avatar-frame-v1.png。
- 参考素材：AI/public/xilian-chibi.png、AI/public/xilian-bubble-corner-v1.png。
- 使用位置：AI/src/VoiceCall.vue 的头像外框。
- 复用：AI/public/xilian-dialog-perch-v1.png 点缀字幕卡片；保留原服饰与人物形象。气泡边角花饰以低透明度用于背景。
- 所有装饰使用空 alt、aria-hidden 与 pointer-events:none，不接收点击；字幕正文和通话控件沿用原逻辑。

## 完整生成提示词

Use case: stylized-concept
Asset type: one transparent decorative circular avatar frame for a narrow voice-call window, not a UI screenshot.
Reference image 1: Xilian character motif/color/style reference only. Reference image 2: existing Xilian rose/feather ornament style reference.
Create a delicate circular portrait wreath in the exact anime illustration language of the references: two slender pearlescent lavender circular filigree rings, one small pale lavender rose and one blush pink rose near 1-2 o'clock, two airy iridescent pink/lavender/cyan wing-feathers curving along the lower-left perimeter, a few small white leaflets and a short narrow translucent ribbon at lower right. A quiet gentle magical-water mood, clean violet outlines and soft cel shading. Airy, polished and legible at 150 pixels.
Composition: square canvas, the circle precisely centered. Keep a perfectly circular EMPTY transparent central hole whose diameter is 62% of the whole image width, centered at (50%,50%). All roses, feathers and filigree remain OUTSIDE that clear central circle. Outer artwork stays within 96% of canvas with small safe margins. The ring must remain fully visible and circular, not tilted, not an oval. Balanced asymmetry, small motifs, much less dense than a floral bouquet.
Background and central hole both genuinely alpha transparent. No portrait, character, face, clothes, lettering, text, logo, watermark, drawn UI, solid circular disc, filled center, checkerboard, opaque rectangle, big glow cloud, or long ribbon tails. Only one usable isolated decorative circular avatar frame.
