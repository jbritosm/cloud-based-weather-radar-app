import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, directives } from "./csp";

describe("content security policy", () => {
  const sources = (name: string) => directives[name] ?? [];

  it("only runs scripts from our own origin: no inline scripts, no eval", () => {
    expect(sources("script-src")).toEqual(["'self'"]);
    expect(contentSecurityPolicy).not.toContain("unsafe-eval");
    expect(sources("script-src")).not.toContain("'unsafe-inline'");
  });

  it("forbids plugins, foreign base URLs and foreign form targets", () => {
    expect(sources("object-src")).toEqual(["'none'"]);
    expect(sources("base-uri")).toEqual(["'self'"]);
    expect(sources("form-action")).toEqual(["'self'"]);
  });

  it("falls back to our own origin for everything not listed", () => {
    expect(sources("default-src")).toEqual(["'self'"]);
  });

  it("allows exactly the external services the app uses, over HTTPS", () => {
    const external = new Set(
      Object.values(directives)
        .flat()
        .filter((s) => s.includes("://")),
    );
    expect([...external].sort()).toEqual([
      "https://api.rainviewer.com",
      "https://tile.openstreetmap.org",
      "https://tilecache.rainviewer.com",
      "https://view.eumetsat.int",
    ]);
    expect([...external].every((s) => s.startsWith("https://"))).toBe(true);
  });

  it("lets the map decode tiles in blob workers, which MapLibre needs", () => {
    expect(sources("worker-src")).toContain("blob:");
  });

  it("is one line, safe to put in an HTML attribute", () => {
    expect(contentSecurityPolicy).not.toMatch(/["\n]/);
  });
});
