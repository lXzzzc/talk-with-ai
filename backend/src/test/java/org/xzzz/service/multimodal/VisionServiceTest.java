package org.xzzz.service.multimodal;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class VisionServiceTest {

    @Test
    void normalizesUserQuestionAndWindowTitle() {
        assertEquals("解释这个报错", VisionService.normalizeQuestion("  解释这个报错  "));
        assertEquals("浏览器 标题", VisionService.normalizeWindowTitle("浏览器\n标题"));
        assertNull(VisionService.normalizeWindowTitle("   "));
    }

    @Test
    void rejectsAnOverlongQuestion() {
        assertThrows(IllegalArgumentException.class,
                () -> VisionService.normalizeQuestion("问".repeat(2001)));
    }
}
