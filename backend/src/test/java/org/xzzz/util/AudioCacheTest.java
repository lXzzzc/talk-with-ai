package org.xzzz.util;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class AudioCacheTest {

    @Test
    void returnsWhatWasPutIn() {
        AudioCache cache = new AudioCache(10, 1024);
        cache.put("k", new byte[]{1, 2, 3});
        assertThat(cache.get("k")).containsExactly((byte) 1, (byte) 2, (byte) 3);
    }

    @Test
    void evictsLeastRecentlyUsedWhenEntryLimitExceeded() {
        AudioCache cache = new AudioCache(2, 1024);
        cache.put("a", new byte[]{1});
        cache.put("b", new byte[]{2});
        cache.get("a");                      // a 变成最近使用
        cache.put("c", new byte[]{3});       // 应该淘汰 b

        assertThat(cache.get("b")).isNull();
        assertThat(cache.get("a")).isNotNull();
        assertThat(cache.get("c")).isNotNull();
        assertThat(cache.size()).isEqualTo(2);
    }

    @Test
    void evictsWhenByteLimitExceeded() {
        AudioCache cache = new AudioCache(100, 10);
        cache.put("one", new byte[8]);
        cache.put("two", new byte[8]);

        assertThat(cache.bytes()).isLessThanOrEqualTo(10);
        assertThat(cache.size()).isEqualTo(1);
    }

    @Test
    void ignoresEmptyPayloads() {
        AudioCache cache = new AudioCache(10, 1024);
        cache.put("empty", new byte[0]);
        cache.put("null", null);
        assertThat(cache.size()).isZero();
        assertThat(cache.bytes()).isZero();
    }

    @Test
    void replacingAKeyDoesNotDoubleCountBytes() {
        AudioCache cache = new AudioCache(10, 1024);
        cache.put("k", new byte[10]);
        cache.put("k", new byte[4]);
        assertThat(cache.bytes()).isEqualTo(4);
        assertThat(cache.size()).isEqualTo(1);
    }

    @Test
    void clearResetsEverything() {
        AudioCache cache = new AudioCache(10, 1024);
        cache.put("k", new byte[10]);
        cache.clear();
        assertThat(cache.size()).isZero();
        assertThat(cache.bytes()).isZero();
    }
}
