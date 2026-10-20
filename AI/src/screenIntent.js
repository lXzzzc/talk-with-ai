const EXPLICIT_VISUAL_CONTEXT = /(?:当前|现在|眼前)(?:的)?(?:页面|窗口|屏幕|界面|画面|应用|软件)|(?:屏幕|页面|窗口|界面|画面)(?:上|里|中)|这个(?:页面|窗口|界面|画面|报错|错误|提示|按钮|图标|软件|应用|图片|图)|这里(?:显示|写着|提示|报错)|截图/u
const VISUAL_REQUEST = /看|瞧|分析|评价|点评|解释|识别|读一下|告诉我|觉得|怎么样|如何|怎么回事|为什么|什么问题|哪里不对|怎么办|处理|解决|好看/u
const NAMED_NON_VISUAL_CONTEXT = /这(?:个|份|段|条)(?:想法|方案|建议|说法|回答|代码|文字|句子|计划|需求|功能|逻辑|故事|名字|观点|做法|问题|内容|消息)/u

const AMBIGUOUS_VISUAL_REQUESTS = [
  /^(?:你)?(?:能|可以)?(?:帮我)?(?:看|看看|看下|瞧|瞧瞧)(?:一下)?(?:这个|这里|现在这个)?(?:是怎么回事|有什么问题|怎么样|如何)?[呢吗呀吧？?。！!]*$/u,
  /^(?:你)?(?:觉得|看)(?:这个|这里)(?:怎么样|怎么这么样|如何|好不好|行不行|有什么问题)?[呢吗呀吧？?。！!]*$/u,
  /^(?:这个|这里)(?:是(?:什么|啥|怎么回事)|怎么(?:了|回事|样|这么样)|为什么(?:这样|不对)|有什么问题|哪里不对|该怎么办|如何处理)[呢吗呀吧？?。！!]*$/u
]

/**
 * Detect prompts whose meaning depends on what is currently visible on screen.
 *
 * This intentionally prefers precision over recall: a named textual subject such as
 * “这个方案怎么样” stays in normal chat, while bare deixis such as “你觉得这个怎么样”
 * asks the desktop client to look at the foreground window.
 */
export function shouldCaptureCurrentWindow(prompt) {
  const normalized = String(prompt ?? '').trim().replace(/\s+/g, ' ')
  if (!normalized) return false

  const lower = normalized.toLowerCase()
  const englishVisualContext = /\b(?:current|this)\s+(?:screen|window|page|interface|error|image)\b/.test(lower)
  const englishBareRequest = /\b(?:what do you think (?:of|about) this|look at this|what is this|why is this happening)\b/.test(lower)
  if (englishVisualContext || englishBareRequest) return true

  const hasExplicitVisualContext = EXPLICIT_VISUAL_CONTEXT.test(normalized)
  if (hasExplicitVisualContext) return VISUAL_REQUEST.test(normalized) || normalized.length <= 18
  if (NAMED_NON_VISUAL_CONTEXT.test(normalized)) return false
  return AMBIGUOUS_VISUAL_REQUESTS.some(pattern => pattern.test(normalized))
}
