# 高清头像处理

使用内置 image_gen 工具，根据用户提供的原始昔涟图片生成清晰度增强版本。原图保留，增强后的 PNG 位于 AI/src/assets/xilian-avatar-hd.png。

生成提示词：

Use case: identity-preserve / precise-object-edit. Edit target: the supplied pink-haired anime character illustration. Create a high resolution square avatar crop from THIS EXACT illustration, not a different drawing. Center the facial oval geometrically at the exact center of the square, with eyes, nose, smiling mouth and chin clearly readable at small 64px icon size. Crop to a closeup face and surrounding hair, retaining the original winking expression, open pink-purple starry eye, exact facial proportions, pink bangs, hands alongside cheeks, and original color palette and linework. Improve clarity: carefully restore crisp clean original anime contours, eye details and hair edges, remove JPEG softness and compression artifacts. Maintain smooth flat color gradients without blur or grain. No added eye, no pose change, no facial redesign, no exaggerated eyelashes, no new accessories, no text, no watermark. Use the available illustration to fill a square edge to edge, no outside black background, no decorative frame, no margins. Output a high-quality square bitmap of at least 1024x1024 pixels suitable for direct high quality downsampling in UI.
