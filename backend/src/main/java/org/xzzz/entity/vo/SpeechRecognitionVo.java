package org.xzzz.entity.vo;

/**
 * 单次录音识别结果。
 */
public record SpeechRecognitionVo(String text, String language, String emotion) {
}
