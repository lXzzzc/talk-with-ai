package org.xzzz.repository;

import java.util.List;

public interface ChatHistroyRepository {

    void save(String type, String conversationId);

    List<String> getconversationIds(String type);
}
