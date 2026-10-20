package org.xzzz.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.xzzz.entity.dto.LocalToolIntentRequest;
import org.xzzz.entity.dto.LocalToolIntentResponse;
import org.xzzz.service.LocalToolIntentService;

@RequiredArgsConstructor
@RestController
@RequestMapping("/ai")
public class LocalToolIntentController {

    private final LocalToolIntentService localToolIntentService;

    @PostMapping("/tool-intent")
    public LocalToolIntentResponse plan(@RequestBody LocalToolIntentRequest request) {
        return localToolIntentService.plan(request.prompt());
    }
}
