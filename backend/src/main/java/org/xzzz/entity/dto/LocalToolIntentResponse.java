package org.xzzz.entity.dto;

import java.util.Map;

/**
 * A proposal only. The backend cannot execute local tools; the desktop client
 * validates this response again and asks the user before invoking anything.
 */
public record LocalToolIntentResponse(
        String tool,
        Map<String, String> arguments,
        String title,
        String description,
        boolean requiresConfirmation
) {
    public static LocalToolIntentResponse none() {
        return new LocalToolIntentResponse("none", Map.of(), "", "", false);
    }
}
