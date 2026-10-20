#!/usr/bin/env node
import os from "node:os";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  isWriteEnabled,
  parseAllowedHosts,
  requireWriteEnabled,
  validateCoordinate,
  validateHttpUrl,
  validateText,
} from "./policy.js";
import {
  captureScreen,
  clickScreen,
  getCursorPosition,
  listVisibleWindows,
  openApplication,
  openUrl,
  type AllowedApplication,
  typeText,
} from "./windows.js";
import {
  getWindowsMcpBridge,
  getWindowsMcpRuntimeInfo,
} from "./windows-mcp.js";

const server = new McpServer(
  {
    name: "talk-with-ai-local-computer-tools",
    version: "0.1.0",
  },
  {
    instructions:
      "Inspect state before acting. Prefer window metadata over coordinates. " +
      "After clicks or typing, capture the screen to verify the result. " +
      "Prefer inspect_desktop and wait_for_ui for accessibility-aware Windows automation. " +
      "Never request or type passwords, API keys, payment data, or other secrets.",
  },
);

function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

async function safeToolCall<T>(operation: () => Promise<T> | T) {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: message }],
      isError: true,
    };
  }
}

server.registerTool(
  "computer_status",
  {
    title: "Computer tool status",
    description:
      "Check platform support, write permission, and URL host restrictions before using local computer tools.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async () => {
    const allowedHosts = [...parseAllowedHosts()];
    const status = {
      platform: process.platform,
      supported: process.platform === "win32",
      writeEnabled: isWriteEnabled(),
      allowedHosts,
      windowsMcp: getWindowsMcpRuntimeInfo(),
    };
    return textResult(JSON.stringify(status, null, 2), status);
  },
);

const displaySchema = z.array(z.number().int().min(0).max(31)).min(1).max(8).optional();
const regionSchema = z
  .tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()])
  .optional();

function validateRegion(region?: [number, number, number, number]) {
  if (!region) return;
  const [left, top, right, bottom] = region;
  validateCoordinate(left, "region.left");
  validateCoordinate(top, "region.top");
  validateCoordinate(right, "region.right");
  validateCoordinate(bottom, "region.bottom");
  if (right <= left || bottom <= top) {
    throw new Error("Desktop region must have right > left and bottom > top.");
  }
}

server.registerTool(
  "windows_mcp_status",
  {
    title: "Check Windows-MCP status",
    description:
      "Start the pinned local Windows-MCP sidecar if needed and report its desktop-control status.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async () => safeToolCall(() => getWindowsMcpBridge().callTool("ControlStatus", {}, 15_000)),
);

server.registerTool(
  "list_displays",
  {
    title: "List Windows displays",
    description: "Return active Windows display bounds, DPI, scale and primary-display metadata.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async () => safeToolCall(() => getWindowsMcpBridge().callTool("DisplayInventory", {})),
);

server.registerTool(
  "inspect_desktop",
  {
    title: "Inspect Windows desktop controls",
    description:
      "Inspect the current Windows UI through accessibility metadata. Can optionally inspect browser DOM or include an annotated screenshot.",
    inputSchema: {
      includeScreenshot: z.boolean().default(false),
      useDom: z.boolean().default(false),
      includeAnnotations: z.boolean().default(true),
      includeUiTree: z.boolean().default(true),
      displays: displaySchema,
      region: regionSchema,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ includeScreenshot, useDom, includeAnnotations, includeUiTree, displays, region }) =>
    safeToolCall(async () => {
      validateRegion(region);
      return getWindowsMcpBridge().callTool("Snapshot", {
        use_vision: includeScreenshot,
        use_dom: useDom,
        use_annotation: includeAnnotations,
        use_ui_tree: includeUiTree,
        ...(displays ? { display: [...new Set(displays)] } : {}),
        ...(region ? { region } : {}),
      });
    }),
);

server.registerTool(
  "capture_desktop",
  {
    title: "Capture Windows desktop",
    description:
      "Capture a fast Windows-MCP screenshot with desktop and window summaries. Avoid private or sensitive content.",
    inputSchema: {
      includeAnnotations: z.boolean().default(false),
      displays: displaySchema,
      region: regionSchema,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ includeAnnotations, displays, region }) =>
    safeToolCall(async () => {
      validateRegion(region);
      return getWindowsMcpBridge().callTool("Screenshot", {
        use_annotation: includeAnnotations,
        ...(displays ? { display: [...new Set(displays)] } : {}),
        ...(region ? { region } : {}),
      });
    }),
);

server.registerTool(
  "wait_for_ui",
  {
    title: "Wait for a Windows UI condition",
    description:
      "Wait for text, a window or an accessible UI element instead of using arbitrary sleeps.",
    inputSchema: {
      condition: z.enum([
        "text_exists",
        "active_window",
        "element_exists",
        "element_enabled",
        "focused_element",
      ]),
      text: z.string().trim().min(1).max(200).optional(),
      windowName: z.string().trim().min(1).max(200).optional(),
      timeoutSeconds: z.number().min(0.5).max(30).default(10),
      intervalSeconds: z.number().min(0.1).max(2).default(0.25),
      useDom: z.boolean().default(false),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ condition, text, windowName, timeoutSeconds, intervalSeconds, useDom }) =>
    safeToolCall(async () => {
      if (intervalSeconds > timeoutSeconds) {
        throw new Error("Wait interval must not exceed the timeout.");
      }
      if (condition === "text_exists" && !text) {
        throw new Error("text is required for the text_exists condition.");
      }
      if (condition === "active_window" && !windowName) {
        throw new Error("windowName is required for the active_window condition.");
      }
      return getWindowsMcpBridge().callTool(
        "WaitFor",
        {
          condition,
          ...(text ? { text } : {}),
          ...(windowName ? { window_name: windowName } : {}),
          timeout: timeoutSeconds,
          interval: intervalSeconds,
          use_dom: useDom,
        },
        Math.ceil((timeoutSeconds + 10) * 1_000),
      );
    }),
);

server.registerTool(
  "launch_installed_application",
  {
    title: "Launch an installed Windows application",
    description:
      "Launch an installed application by its localized Start Menu name. Executable paths and arguments are never accepted. Requires write actions to be enabled.",
    inputSchema: {
      name: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Application name contains control characters."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ name }) =>
    safeToolCall(async () => {
      requireWriteEnabled("launch_installed_application");
      return getWindowsMcpBridge().callTool("App", { mode: "launch", name }, 45_000);
    }),
);

server.registerTool(
  "get_system_info",
  {
    title: "Get local system information",
    description: "Return basic, non-secret operating system and runtime information.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async () => {
    const info = {
      platform: os.platform(),
      release: os.release(),
      architecture: os.arch(),
      hostname: os.hostname(),
      nodeVersion: process.version,
    };
    return textResult(JSON.stringify(info, null, 2), info);
  },
);

server.registerTool(
  "list_windows",
  {
    title: "List visible Windows applications",
    description:
      "List visible top-level Windows application windows. Use this before coordinate-based actions.",
    inputSchema: {
      titleContains: z.string().max(200).optional(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ titleContains }) =>
    safeToolCall(async () => {
      const windows = await listVisibleWindows();
      const needle = titleContains?.trim().toLowerCase();
      const filtered = needle
        ? windows.filter((window) => window.title.toLowerCase().includes(needle))
        : windows;
      return textResult(
        filtered.length > 0
          ? JSON.stringify(filtered, null, 2)
          : "No matching visible windows were found.",
        { windows: filtered },
      );
    }),
);

server.registerTool(
  "get_cursor_position",
  {
    title: "Get pointer position",
    description: "Return the current mouse pointer coordinates without changing the computer.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async () =>
    safeToolCall(async () => {
      const position = await getCursorPosition();
      return textResult(JSON.stringify(position), position);
    }),
);

server.registerTool(
  "capture_screen",
  {
    title: "Capture the local screen",
    description:
      "Capture all Windows displays and return a PNG image. Avoid capturing secrets or private content.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async () =>
    safeToolCall(async () => {
      const capture = await captureScreen();
      return {
        content: [
          {
            type: "text" as const,
            text: `Captured ${capture.width}x${capture.height} at (${capture.left}, ${capture.top}).`,
          },
          {
            type: "image" as const,
            data: capture.data,
            mimeType: "image/png",
          },
        ],
      };
    }),
);

server.registerTool(
  "open_application",
  {
    title: "Open an allowlisted application",
    description:
      "Open Notepad, Calculator, Paint, or File Explorer. Requires local write actions to be enabled.",
    inputSchema: {
      application: z.enum(["notepad", "calculator", "paint", "explorer"]),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ application }) =>
    safeToolCall(async () => {
      requireWriteEnabled("open_application");
      await openApplication(application as AllowedApplication);
      return textResult(`Opened ${application}.`);
    }),
);

server.registerTool(
  "open_url",
  {
    title: "Open an HTTP URL",
    description:
      "Open a validated HTTP or HTTPS URL in the default browser. Honors TALK_AI_TOOLS_ALLOWED_HOSTS and requires write actions to be enabled.",
    inputSchema: {
      url: z.string().max(2_048),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  async ({ url }) =>
    safeToolCall(async () => {
      requireWriteEnabled("open_url");
      const validatedUrl = validateHttpUrl(url);
      await openUrl(validatedUrl);
      return textResult(`Opened ${validatedUrl.origin}.`);
    }),
);

server.registerTool(
  "click_screen",
  {
    title: "Click a screen coordinate",
    description:
      "Move the pointer to a screen coordinate and click. Inspect or capture the screen first. Requires write actions to be enabled.",
    inputSchema: {
      x: z.number().int(),
      y: z.number().int(),
      button: z.enum(["left", "right", "middle"]).default("left"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  async ({ x, y, button }) =>
    safeToolCall(async () => {
      requireWriteEnabled("click_screen");
      validateCoordinate(x, "x");
      validateCoordinate(y, "y");
      await clickScreen(x, y, button);
      return textResult(`Clicked ${button} at (${x}, ${y}).`);
    }),
);

server.registerTool(
  "type_text",
  {
    title: "Type text into the focused control",
    description:
      "Paste non-sensitive text into the currently focused control. Never use for passwords, tokens, payment data, or messages sent to other people. Requires write actions to be enabled.",
    inputSchema: {
      text: z.string().min(1).max(2_000),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  async ({ text }) =>
    safeToolCall(async () => {
      requireWriteEnabled("type_text");
      validateText(text);
      await typeText(text);
      return textResult(`Typed ${text.length} characters.`);
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("talk-with-ai local computer MCP server is ready");
