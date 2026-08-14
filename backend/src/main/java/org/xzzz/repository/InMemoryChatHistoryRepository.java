package org.xzzz.repository;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;


@Component
public class InMemoryChatHistoryRepository implements ChatHistroyRepository{

    private final Map<String,List<String>> chatHistory=new HashMap<>();

    @Override
    public void save(String type, String conversationId) {
        if(!chatHistory.containsKey(type)){
            chatHistory.put(type,new ArrayList<>());
        }
        List<String> chatIds=chatHistory.get(type);
        if(chatIds.contains(conversationId)){
            return;
        }
        chatIds.add(conversationId);
    }

    @Override
    public List<String> getconversationIds(String type) {
//        List<String> chatIds= chatHistory.get(type);
//        return chatIds==null?new ArrayList<>():chatIds;
        return chatHistory.getOrDefault(type,List.of());
    }
}
