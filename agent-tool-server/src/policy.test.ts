import assert from "node:assert/strict";
import test from "node:test";

import {
  isWriteEnabled,
  parseAllowedHosts,
  requireWriteEnabled,
  validateCoordinate,
  validateHttpUrl,
  validateText,
} from "./policy.js";

test("write actions are disabled by default", () => {
  assert.equal(isWriteEnabled({}), false);
  assert.throws(() => requireWriteEnabled("click", {}), /disabled/);
});

test("write actions accept explicit truthy values", () => {
  assert.equal(isWriteEnabled({ TALK_AI_TOOLS_WRITE_ENABLED: "true" }), true);
  assert.doesNotThrow(() =>
    requireWriteEnabled("click", { TALK_AI_TOOLS_WRITE_ENABLED: "1" }),
  );
});

test("HTTP URL validation rejects credentials and unsupported schemes", () => {
  assert.throws(() => validateHttpUrl("file:///C:/secret.txt"), /Only http/);
  assert.throws(
    () => validateHttpUrl("https://user:password@example.com"),
    /credentials/,
  );
});

test("HTTP URL validation honors the host allowlist", () => {
  const hosts = parseAllowedHosts("example.com, LOCALHOST");
  assert.equal(validateHttpUrl("https://example.com/path", hosts).hostname, "example.com");
  assert.throws(() => validateHttpUrl("https://openai.com", hosts), /not in/);
});

test("coordinate and text limits are enforced", () => {
  assert.equal(validateCoordinate(-500, "x"), -500);
  assert.throws(() => validateCoordinate(100_001, "x"), /integer/);
  assert.equal(validateText("hello"), "hello");
  assert.throws(() => validateText(""), /empty/);
  assert.throws(() => validateText("x".repeat(2_001)), /2000/);
});
