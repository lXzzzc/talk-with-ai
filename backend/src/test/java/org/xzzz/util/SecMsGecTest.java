package org.xzzz.util;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class SecMsGecTest {

    /**
     * 用独立实现（PowerShell 的 SHA-256）算出的期望值，把算法钉死，防止以后被改坏。
     * 输入：unix=1700000000 → ticks=133444734000000000
     */
    @Test
    void generatesKnownHashForFixedTimestamp() {
        assertThat(SecMsGec.generate(1_700_000_000L))
                .isEqualTo("42301B335578FEFDAE2637DED1ABD614505D432559EC08032B82048483726AFF");
    }

    @Test
    void isUppercaseHexOf64Chars() {
        assertThat(SecMsGec.generate(1_700_000_000L)).hasSize(64).matches("[0-9A-F]{64}");
    }

    @Test
    void isStableWithinTheSameFiveMinuteWindow() {
        // 1700000000 所在的窗口是 [1699999800, 1700000100)
        assertThat(SecMsGec.generate(1_700_000_000L))
                .isEqualTo(SecMsGec.generate(1_700_000_099L));
    }

    @Test
    void changesOnceTheWindowRolls() {
        assertThat(SecMsGec.generate(1_700_000_000L))
                .isNotEqualTo(SecMsGec.generate(1_700_000_100L));
    }
}
