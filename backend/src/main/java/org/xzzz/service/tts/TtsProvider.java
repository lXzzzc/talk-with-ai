package org.xzzz.service.tts;

interface TtsProvider extends AutoCloseable {
    String name();

    boolean available();

    String cacheKey(String text);

    byte[] synthesize(String text);

    StreamingTtsSession openStreamingSession(StreamingTtsListener listener);

    @Override
    default void close() { }
}
