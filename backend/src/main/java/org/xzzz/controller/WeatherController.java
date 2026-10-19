package org.xzzz.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.xzzz.entity.vo.WeatherVo;
import org.xzzz.service.WeatherService;

@RestController
@RequestMapping("/weather")
@RequiredArgsConstructor
public class WeatherController {

    private final WeatherService weatherService;

    @GetMapping
    public WeatherVo weather(
            @RequestParam(required = false) String city,
            @RequestParam(required = false) Double latitude,
            @RequestParam(required = false) Double longitude) {
        if (city != null && !city.isBlank()) {
            return weatherService.byCity(city);
        }
        if (latitude == null || longitude == null) {
            throw new IllegalArgumentException("请提供 city，或同时提供 latitude 和 longitude");
        }
        return weatherService.byCoordinates(latitude, longitude);
    }
}
