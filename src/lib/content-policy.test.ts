import { describe, expect, it } from "vitest";

import { contentPolicy, makeNonce } from "./content-policy";

const directive = (policy: string, name: string) =>
  policy
    .split("; ")
    .find((part) => part.startsWith(`${name} `) || part === name)
    ?.split(" ")
    .slice(1);

describe("what a page may load and run", () => {
  it("runs inline script only with the number made for the request", () => {
    const policy = contentPolicy({ nonce: "abc123", https: true });
    const scripts = directive(policy, "script-src");
    expect(scripts).toContain("'nonce-abc123'");
    expect(scripts).toContain("'self'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(directive(policy, "object-src")).toEqual(["'none'"]);
    expect(directive(policy, "form-action")).toEqual(["'self'"]);
    expect(directive(policy, "frame-ancestors")).toEqual(["'self'"]);
  });

  it("asks for HTTPS only where the site is served over it", () => {
    expect(contentPolicy({ nonce: "n", https: true })).toContain("upgrade-insecure-requests");
    expect(contentPolicy({ nonce: "n", https: false })).not.toContain("upgrade-insecure-requests");
  });

  it("allows eval for the development server only", () => {
    expect(directive(contentPolicy({ nonce: "n", https: false, development: true }), "script-src")).toContain(
      "'unsafe-eval'",
    );
  });

  it("makes a different number every time", () => {
    const numbers = new Set(Array.from({ length: 50 }, makeNonce));
    expect(numbers.size).toBe(50);
    for (const number of numbers) expect(number).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
