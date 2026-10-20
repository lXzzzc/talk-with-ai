package org.xzzz.service.tts;

/** Receives raw 24 kHz, 16-bit, mono PCM chunks from a streaming TTS session. */
public interface StreamingTtsListener {
    void onAudio(byte[] audio);

    /** Called after all audio for the submitted text has been delivered. */
    default void onSentence(String text) { }
}
