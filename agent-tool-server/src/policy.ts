const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export const MAX_COORDINATE = 100_000;
export const MAX_TEXT_LENGTH = 2_000;

export function isWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return TRUE_VALUES.has((env.TALK_AI_TOOLS_WRITE_ENABLED ?? "").trim().toLowerCase());
}

export function requireWriteEnabled(
  action: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isWriteEnabled(env)) {
    throw new Error(
      `Write action '${action}' is disabled. Set TALK_AI_TOOLS_WRITE_ENABLED=1 ` +
        "when registering the MCP server, then restart Codex.",
    );
  }
}

export function parseAllowedHosts(raw = process.env.TALK_AI_TOOLS_ALLOWED_HOSTS ?? ""): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function validateHttpUrl(
  rawUrl: string,
  allowedHosts = parseAllowedHosts(),
): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("The URL is invalid.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }

  if (url.username || url.password) {
    throw new Error("URLs containing embedded credentials are not allowed.");
  }

  if (allowedHosts.size > 0 && !allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error(
      `Host '${url.hostname}' is not in TALK_AI_TOOLS_ALLOWED_HOSTS.`,
    );
  }

  return url;
}

export function validateCoordinate(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_COORDINATE) {
    throw new Error(
      `${name} must be an integer between -${MAX_COORDINATE} and ${MAX_COORDINATE}.`,
    );
  }
  return value;
}

export function validateText(text: string): string {
  if (text.length === 0) {
    throw new Error("Text must not be empty.");
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text must not exceed ${MAX_TEXT_LENGTH} characters.`);
  }
  return text;
}
