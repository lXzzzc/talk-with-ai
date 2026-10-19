package org.xzzz.entity.vo;

import java.util.List;

public record WeatherVo(
        String location,
        double latitude,
        double longitude,
        String timezone,
        Current current,
        List<Daily> forecast,
        List<String> advice
) {
    public record Current(
            String time,
            double temperature,
            double apparentTemperature,
            int humidity,
            double precipitation,
            double windSpeed,
            int weatherCode,
            String condition,
            boolean daytime
    ) {
    }

    public record Daily(
            String date,
            double minTemperature,
            double maxTemperature,
            int precipitationProbability,
            int weatherCode,
            String condition
    ) {
    }
}
