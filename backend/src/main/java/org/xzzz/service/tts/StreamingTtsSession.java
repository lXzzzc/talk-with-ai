package org.xzzz.service.tts;

/** Provider-neutral streaming TTS session used by the realtime voice call. */
public interface StreamingTtsSession extends AutoCloseable {
    void write(String text);

    void finish();

    void cancel();

    @Override
    void close();
}
