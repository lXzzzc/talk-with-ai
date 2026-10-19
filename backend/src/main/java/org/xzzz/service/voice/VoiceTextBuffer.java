package org.xzzz.service.voice;

import java.util.ArrayList;
import java.util.List;

/** 按短句送入 TTS，并跨 token 去除角色的括号动作描写。 */
final class VoiceTextBuffer {
    private final StringBuilder pending = new StringBuilder();
    private int bracketDepth;

    List<String> append(String delta) {
        List<String> sentences = new ArrayList<>();
        for (char c : delta.toCharArray()) {
            if ("（([【".indexOf(c) >= 0) { bracketDepth++; continue; }
            if ("）)]】".indexOf(c) >= 0 && bracketDepth > 0) { bracketDepth--; continue; }
            if (bracketDepth > 0 || c == '*' || c == '`' || c == '#') continue;
            pending.append(c);
            if ("。！？!?\n".indexOf(c) >= 0 || pending.length() >= 120
                    || (pending.length() >= 30 && "，,；;".indexOf(c) >= 0)) {
                String sentence = finish();
                if (!sentence.isEmpty()) sentences.add(sentence);
            }
        }
        return sentences;
    }

    String finish() {
        String result = pending.toString().trim();
        pending.setLength(0);
        return result;
    }
}
