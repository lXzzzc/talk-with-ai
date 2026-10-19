package org.xzzz.service;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;
import org.xzzz.entity.vo.WeatherVo;
import org.xzzz.exception.WeatherException;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class WeatherService {

    private final RestClient.Builder restClientBuilder;

    @Value("${weather.geocoding-url:https://geocoding-api.open-meteo.com/v1/search}")
    private String geocodingUrl;

    @Value("${weather.forecast-url:https://api.open-meteo.com/v1/forecast}")
    private String forecastUrl;

    public WeatherVo byCity(String city) {
        String normalized = city == null ? "" : city.trim();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("city 不能为空");
        }
        if (normalized.length() > 100) {
            throw new IllegalArgumentException("city 长度不能超过 100 个字符");
        }

        URI uri = UriComponentsBuilder.fromUriString(geocodingUrl)
                .queryParam("name", normalized)
                .queryParam("count", 1)
                .queryParam("language", "zh")
                .queryParam("format", "json")
                .build()
                .encode()
                .toUri();
        Map<String, Object> root = getJson(uri, "城市查询失败");
        List<?> results = list(root.get("results"));
        if (results.isEmpty() || !(results.getFirst() instanceof Map<?, ?> place)) {
            throw new IllegalArgumentException("没有找到城市：“" + normalized + "”");
        }
        String location = joinLocation(text(place.get("name")), text(place.get("admin1")),
                text(place.get("country")));
        return forecast(number(place.get("latitude")), number(place.get("longitude")), location);
    }

    public WeatherVo byCoordinates(double latitude, double longitude) {
        if (!Double.isFinite(latitude) || latitude < -90 || latitude > 90) {
            throw new IllegalArgumentException("latitude 必须在 -90 到 90 之间");
        }
        if (!Double.isFinite(longitude) || longitude < -180 || longitude > 180) {
            throw new IllegalArgumentException("longitude 必须在 -180 到 180 之间");
        }
        return forecast(latitude, longitude, "当前位置");
    }

    private WeatherVo forecast(double latitude, double longitude, String location) {
        URI uri = UriComponentsBuilder.fromUriString(forecastUrl)
                .queryParam("latitude", latitude)
                .queryParam("longitude", longitude)
                .queryParam("current", "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day")
                .queryParam("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max")
                .queryParam("timezone", "auto")
                .queryParam("forecast_days", 3)
                .build()
                .encode()
                .toUri();

        Map<String, Object> root = getJson(uri, "天气查询失败");
        Map<?, ?> current = map(root.get("current"));
        if (current.isEmpty()) {
            throw new WeatherException("天气服务暂时没有返回当前天气");
        }

        int weatherCode = integer(current.get("weather_code"));
        WeatherVo.Current now = new WeatherVo.Current(
                text(current.get("time")),
                number(current.get("temperature_2m")),
                number(current.get("apparent_temperature")),
                integer(current.get("relative_humidity_2m")),
                number(current.get("precipitation")),
                number(current.get("wind_speed_10m")),
                weatherCode,
                condition(weatherCode),
                integer(current.get("is_day")) == 1
        );

        Map<?, ?> daily = map(root.get("daily"));
        List<WeatherVo.Daily> forecast = new ArrayList<>();
        List<?> dates = list(daily.get("time"));
        for (int i = 0; i < Math.min(3, dates.size()); i++) {
            int code = integer(valueAt(daily, "weather_code", i));
            forecast.add(new WeatherVo.Daily(
                    text(dates.get(i)),
                    number(valueAt(daily, "temperature_2m_min", i)),
                    number(valueAt(daily, "temperature_2m_max", i)),
                    integer(valueAt(daily, "precipitation_probability_max", i)),
                    code,
                    condition(code)
            ));
        }

        int maxRainChance = forecast.stream().mapToInt(WeatherVo.Daily::precipitationProbability).max().orElse(0);
        return new WeatherVo(location, number(root.getOrDefault("latitude", latitude)),
                number(root.getOrDefault("longitude", longitude)), text(root.get("timezone")), now, forecast,
                buildAdvice(now, maxRainChance));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> getJson(URI uri, String failureMessage) {
        try {
            Map<String, Object> result = restClientBuilder.build().get().uri(uri).retrieve().body(Map.class);
            if (result == null) {
                throw new WeatherException(failureMessage + "：服务返回为空");
            }
            return result;
        } catch (WeatherException e) {
            throw e;
        } catch (Exception e) {
            throw new WeatherException(failureMessage + "，请稍后重试", e);
        }
    }

    private static Object valueAt(Map<?, ?> parent, String field, int index) {
        List<?> values = list(parent.get(field));
        return index < values.size() ? values.get(index) : null;
    }

    private static Map<?, ?> map(Object value) {
        return value instanceof Map<?, ?> result ? result : Map.of();
    }

    private static List<?> list(Object value) {
        return value instanceof List<?> result ? result : List.of();
    }

    private static String text(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private static double number(Object value) {
        return value instanceof Number number ? number.doubleValue() : 0;
    }

    private static int integer(Object value) {
        return value instanceof Number number ? number.intValue() : 0;
    }

    private static String joinLocation(String name, String admin1, String country) {
        return java.util.stream.Stream.of(name, admin1, country)
                .filter(value -> value != null && !value.isBlank())
                .distinct()
                .reduce((left, right) -> left + " · " + right)
                .orElse(name);
    }

    private static List<String> buildAdvice(WeatherVo.Current current, int maxRainChance) {
        List<String> advice = new ArrayList<>();
        int code = current.weatherCode();
        if (maxRainChance >= 50 || isRain(code)) advice.add("有降水可能，出门带伞并注意路滑。");
        if (isThunderstorm(code)) advice.add("可能有雷暴，尽量减少户外活动并远离高处和树下。");
        if (isSnow(code)) advice.add("可能降雪或结冰，注意保暖，驾车请降低车速。");
        if (current.apparentTemperature() >= 33) advice.add("体感炎热，注意补水防晒，避免午后长时间暴晒。");
        else if (current.apparentTemperature() >= 28) advice.add("体感偏热，建议穿轻薄透气衣物并及时补水。");
        else if (current.apparentTemperature() <= 5) advice.add("体感较冷，建议增加外套并注意手脚保暖。");
        else advice.add("体感温度较舒适，可按日常着装出行。");
        if (current.windSpeed() >= 30) advice.add("风力较强，请收好易坠物品，骑行注意侧风。");
        if (current.humidity() <= 30) advice.add("空气偏干，记得补水并适当保湿。");
        return advice;
    }

    private static boolean isRain(int code) {
        return (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
    }

    private static boolean isSnow(int code) {
        return (code >= 71 && code <= 77) || (code >= 85 && code <= 86);
    }

    private static boolean isThunderstorm(int code) {
        return code >= 95;
    }

    private static String condition(int code) {
        return switch (code) {
            case 0 -> "晴";
            case 1 -> "大部晴朗";
            case 2 -> "多云";
            case 3 -> "阴";
            case 45, 48 -> "雾";
            case 51, 53, 55 -> "毛毛雨";
            case 56, 57 -> "冻毛毛雨";
            case 61 -> "小雨";
            case 63 -> "中雨";
            case 65 -> "大雨";
            case 66, 67 -> "冻雨";
            case 71 -> "小雪";
            case 73 -> "中雪";
            case 75, 77 -> "大雪";
            case 80, 81, 82 -> "阵雨";
            case 85, 86 -> "阵雪";
            case 95, 96, 99 -> "雷暴";
            default -> "天气状况未知";
        };
    }
}
