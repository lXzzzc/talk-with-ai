package org.xzzz.service.multimodal;

/**
 * OpenAI 兼容 Chat Completions 响应中项目关心的字段。
 */
public record ModelStudioCompletion(String content, String language, String emotion) {
}
