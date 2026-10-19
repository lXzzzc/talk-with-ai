package org.xzzz.tool;

import org.junit.jupiter.api.Test;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.xzzz.entity.vo.WeatherVo;
import org.xzzz.service.WeatherService;

import java.lang.reflect.Method;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WeatherToolsTest {

    @Test
    void exposesWeatherServiceAsModelTool() throws Exception {
        WeatherService weatherService = mock(WeatherService.class);
        WeatherVo weather = new WeatherVo(
                "成都 · 四川 · 中国",
                30.67,
                104.07,
                "Asia/Shanghai",
                new WeatherVo.Current("2026-10-18T10:00", 20, 19, 65, 0, 8, 2, "多云", true),
                List.of(),
                List.of("体感温度较舒适，可按日常着装出行。")
        );
        when(weatherService.byCity("成都")).thenReturn(weather);

        WeatherTools tools = new WeatherTools(weatherService);

        assertThat(tools.getWeatherByCity("成都")).isSameAs(weather);
        verify(weatherService).byCity("成都");

        Method method = WeatherTools.class.getMethod("getWeatherByCity", String.class);
        assertThat(method.getAnnotation(Tool.class).name()).isEqualTo("get_weather_by_city");
        assertThat(method.getParameterAnnotations()[0])
                .anyMatch(annotation -> annotation instanceof ToolParam);
    }
}
