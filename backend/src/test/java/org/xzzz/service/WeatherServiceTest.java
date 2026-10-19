package org.xzzz.service;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import org.xzzz.entity.vo.WeatherVo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class WeatherServiceTest {

    @Test
    void mapsForecastAndBuildsActionableAdvice() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        WeatherService service = new WeatherService(builder);
        ReflectionTestUtils.setField(service, "forecastUrl", "https://weather.test/v1/forecast");

        server.expect(requestTo(startsWith("https://weather.test/v1/forecast?")))
                .andRespond(withSuccess("""
                        {
                          "latitude": 30.3,
                          "longitude": 120.2,
                          "timezone": "Asia/Shanghai",
                          "current": {
                            "time": "2026-10-17T15:00",
                            "temperature_2m": 34.0,
                            "apparent_temperature": 36.5,
                            "relative_humidity_2m": 62,
                            "precipitation": 1.2,
                            "weather_code": 95,
                            "wind_speed_10m": 35.0,
                            "is_day": 1
                          },
                          "daily": {
                            "time": ["2026-10-17", "2026-10-18", "2026-10-19"],
                            "weather_code": [95, 61, 2],
                            "temperature_2m_min": [25.0, 24.0, 23.0],
                            "temperature_2m_max": [35.0, 32.0, 30.0],
                            "precipitation_probability_max": [80, 60, 20]
                          }
                        }
                        """, MediaType.APPLICATION_JSON));

        WeatherVo result = service.byCoordinates(30.3, 120.2);

        assertThat(result.current().condition()).isEqualTo("雷暴");
        assertThat(result.forecast()).hasSize(3);
        assertThat(result.advice()).anyMatch(item -> item.contains("带伞"));
        assertThat(result.advice()).anyMatch(item -> item.contains("雷暴"));
        assertThat(result.advice()).anyMatch(item -> item.contains("补水防晒"));
        assertThat(result.advice()).anyMatch(item -> item.contains("风力较强"));
        server.verify();
    }
}
