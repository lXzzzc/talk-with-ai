package org.xzzz.entity.dto;

/**
 * 桌面客户端提供的非敏感运行上下文。
 *
 * <p>它只描述客户端已确认完成的动作，不包含程序路径、窗口内容或用户文件。
 */
public record ClientContext(String recentApplication, String localAction) {
}
