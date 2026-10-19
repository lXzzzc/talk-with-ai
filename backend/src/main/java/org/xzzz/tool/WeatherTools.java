package org.xzzz.tool;

import lombok.RequiredArgsConstructor;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;
import org.xzzz.entity.vo.WeatherVo;
import org.xzzz.service.WeatherService;

/**
 * Exposes the application's weather capability to the chat model.
 *
 * <p>The model receives the tool schema, while the actual HTTP request to Open-Meteo
 * remains on the server. This keeps the external service implementation and validation
 * in {@link WeatherService} as the single source of truth.</p>
 */
@Component
@RequiredArgsConstructor
public class WeatherTools {

    private final WeatherService weatherService;

    @Tool(
            name = "get_weather_by_city",
            description = "查询指定城市的实时天气、未来三天预报和出行建议。用户询问当前、今天、明天或近期天气时调用。"
    )
    public WeatherVo getWeatherByCity(
            @ToolParam(description = "要查询的城市名称，例如：成都、杭州、北京市") String city) {
        return weatherService.byCity(city);
    }
}
