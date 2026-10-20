package org.xzzz.util;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 语音合成结果的 LRU 缓存。
 *
 * <p>同一句话（同一音色、同一语速）反复合成很常见——前端是分句朗读的，重复句子会重复请求
 * 上游接口。这里按「条数 + 总字节数」双重上限做 LRU 淘汰，避免无界增长。
 */
@Slf4j
@Component
public class AudioCache {

    private final int maxEntries;
    private final long maxBytes;
    /** accessOrder = true，即按访问顺序排列，头部就是最久未使用的。 */
    private final LinkedHashMap<String, byte[]> entries = new LinkedHashMap<>(16, 0.75f, true);
    private long currentBytes;

    public AudioCache(@Value("${tts.cache.max-entries:200}") int maxEntries,
                      @Value("${tts.cache.max-bytes:52428800}") long maxBytes) {
        this.maxEntries = maxEntries;
        this.maxBytes = maxBytes;
    }

    public synchronized byte[] get(String key) {
        return entries.get(key);
    }

    public synchronized void put(String key, byte[] value) {
        if (value == null || value.length == 0) {
            return;
        }
        byte[] previous = entries.put(key, value);
        if (previous != null) {
            currentBytes -= previous.length;
        }
        currentBytes += value.length;
        evict();
    }

    private void evict() {
        Iterator<Map.Entry<String, byte[]>> iterator = entries.entrySet().iterator();
        while (iterator.hasNext() && (entries.size() > maxEntries || currentBytes > maxBytes)) {
            Map.Entry<String, byte[]> eldest = iterator.next();
            currentBytes -= eldest.getValue().length;
            iterator.remove();
        }
    }

    public synchronized void clear() {
        entries.clear();
        currentBytes = 0;
    }

    public synchronized int size() {
        return entries.size();
    }

    public synchronized long bytes() {
        return currentBytes;
    }
}
