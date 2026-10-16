import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { validateCoordinate, validateText } from "./policy.js";

const execFileAsync = promisify(execFile);
const POWERSHELL_TIMEOUT_MS = 15_000;

export type VisibleWindow = {
  processId: number;
  processName: string;
  title: string;
  handle: string;
};

export type CursorPosition = { x: number; y: number };

export type ScreenCapture = {
  data: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

const APPLICATIONS = {
  notepad: { command: "notepad.exe", args: [] },
  calculator: { command: "calc.exe", args: [] },
  paint: { command: "mspaint.exe", args: [] },
  explorer: { command: "explorer.exe", args: [] },
} as const;

export type AllowedApplication = keyof typeof APPLICATIONS;

async function runPowerShell(
  script: string,
  extraEnv: Record<string, string> = {},
): Promise<string> {
  if (process.platform !== "win32") {
    throw new Error("This local computer tool server currently supports Windows only.");
  }

  try {
    const result = await execFileAsync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Sta",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, ...extraEnv },
        maxBuffer: 4 * 1024 * 1024,
        timeout: POWERSHELL_TIMEOUT_MS,
        windowsHide: true,
      },
    );
    return result.stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Windows automation command failed: ${message}`);
  }
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

export async function listVisibleWindows(): Promise<VisibleWindow[]> {
  const script = String.raw`
$windows = Get-Process |
  Where-Object { $_.MainWindowHandle -ne 0 -and -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle) } |
  Sort-Object ProcessName, Id |
  ForEach-Object {
    [PSCustomObject]@{
      processId = $_.Id
      processName = $_.ProcessName
      title = $_.MainWindowTitle
      handle = $_.MainWindowHandle.ToString()
    }
  }
@($windows) | ConvertTo-Json -Compress
`;
  const output = await runPowerShell(script);
  if (!output) return [];
  const windows = parseJson<VisibleWindow[]>(output, "Window enumeration");
  return Array.isArray(windows) ? windows : [windows];
}

export async function getCursorPosition(): Promise<CursorPosition> {
  const script = String.raw`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class TalkAiCursorReader {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
}
"@
$point = New-Object TalkAiCursorReader+POINT
if (-not [TalkAiCursorReader]::GetCursorPos([ref]$point)) { throw "GetCursorPos failed" }
@{ x = $point.X; y = $point.Y } | ConvertTo-Json -Compress
`;
  return parseJson<CursorPosition>(await runPowerShell(script), "Cursor position");
}

export async function captureScreen(): Promise<ScreenCapture> {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "talk-ai-screen-"));
  const capturePath = path.join(tempDirectory, `${randomUUID()}.png`);
  const script = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$capturePath = [Environment]::GetEnvironmentVariable("TALK_AI_CAPTURE_PATH")
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
  $bitmap.Save($capturePath, [System.Drawing.Imaging.ImageFormat]::Png)
  @{
    left = $bounds.Left
    top = $bounds.Top
    width = $bounds.Width
    height = $bounds.Height
  } | ConvertTo-Json -Compress
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
`;

  try {
    const bounds = parseJson<Omit<ScreenCapture, "data">>(
      await runPowerShell(script, { TALK_AI_CAPTURE_PATH: capturePath }),
      "Screen capture",
    );
    const image = await readFile(capturePath);
    return { ...bounds, data: image.toString("base64") };
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

export async function openApplication(application: AllowedApplication): Promise<void> {
  const target = APPLICATIONS[application];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(target.command, target.args, {
      detached: true,
      shell: false,
      stdio: "ignore",
      windowsHide: false,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export async function openUrl(url: URL): Promise<void> {
  const script = String.raw`
$url = [Environment]::GetEnvironmentVariable("TALK_AI_OPEN_URL")
Start-Process -FilePath $url
`;
  await runPowerShell(script, { TALK_AI_OPEN_URL: url.toString() });
}

export async function clickScreen(
  x: number,
  y: number,
  button: "left" | "right" | "middle",
): Promise<void> {
  validateCoordinate(x, "x");
  validateCoordinate(y, "y");
  const script = String.raw`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class TalkAiMouseWriter {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}
"@
$x = [int][Environment]::GetEnvironmentVariable("TALK_AI_MOUSE_X")
$y = [int][Environment]::GetEnvironmentVariable("TALK_AI_MOUSE_Y")
$button = [Environment]::GetEnvironmentVariable("TALK_AI_MOUSE_BUTTON")
if (-not [TalkAiMouseWriter]::SetCursorPos($x, $y)) { throw "SetCursorPos failed" }
switch ($button) {
  "left"   { $down = 0x0002; $up = 0x0004 }
  "right"  { $down = 0x0008; $up = 0x0010 }
  "middle" { $down = 0x0020; $up = 0x0040 }
  default { throw "Unsupported mouse button" }
}
[TalkAiMouseWriter]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 40
[TalkAiMouseWriter]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
`;
  await runPowerShell(script, {
    TALK_AI_MOUSE_X: String(x),
    TALK_AI_MOUSE_Y: String(y),
    TALK_AI_MOUSE_BUTTON: button,
  });
}

export async function typeText(text: string): Promise<void> {
  validateText(text);
  const script = String.raw`
Add-Type -AssemblyName System.Windows.Forms
$text = [Environment]::GetEnvironmentVariable("TALK_AI_INPUT_TEXT")
$hadText = [System.Windows.Forms.Clipboard]::ContainsText()
$previous = if ($hadText) { [System.Windows.Forms.Clipboard]::GetText() } else { $null }
try {
  [System.Windows.Forms.Clipboard]::SetText($text)
  Start-Sleep -Milliseconds 80
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Milliseconds 80
} finally {
  if ($hadText) {
    [System.Windows.Forms.Clipboard]::SetText($previous)
  } else {
    [System.Windows.Forms.Clipboard]::Clear()
  }
}
`;
  await runPowerShell(script, { TALK_AI_INPUT_TEXT: text });
}
