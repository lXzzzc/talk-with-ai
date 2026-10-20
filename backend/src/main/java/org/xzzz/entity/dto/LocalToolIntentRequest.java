package org.xzzz.entity.dto;

/**
 * A stateless request asking the model whether one of the desktop allowlisted
 * tools is needed for the user's current message.
 */
public record LocalToolIntentRequest(String prompt) {
}
