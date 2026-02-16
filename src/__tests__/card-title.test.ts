import { describe, it, expect } from "vitest";
import { buildTitleLine } from "../ui/Card.js";

describe("buildTitleLine", () => {
  it("produces a string that fills exactly innerWidth", () => {
    const { prefix, paddedName, suffix } = buildTitleLine("○", "my task", "e8552c29", 30);
    const full = prefix + paddedName + suffix;
    expect(full.length).toBe(30);
  });

  it("pads short names with spaces", () => {
    const { prefix, paddedName, suffix } = buildTitleLine("○", "hi", "abcd1234", 30);
    const full = prefix + paddedName + suffix;
    expect(full.length).toBe(30);
    expect(full).toContain("hi");
    expect(full).toContain("abcd1234");
    // Name region should be padded with trailing spaces
    expect(paddedName.startsWith("hi")).toBe(true);
    expect(paddedName.trimEnd().length).toBeLessThan(paddedName.length);
  });

  it("truncates long names to fit", () => {
    const longName = "a".repeat(100);
    const { prefix, paddedName, suffix } = buildTitleLine("●", longName, "deadbeef", 30);
    const full = prefix + paddedName + suffix;
    expect(full.length).toBe(30);
    expect(full).toContain("deadbeef");
  });

  it("handles no indicator with a leading space", () => {
    const { prefix, paddedName, suffix } = buildTitleLine("", "task", "id123456", 25);
    const full = prefix + paddedName + suffix;
    expect(full.length).toBe(25);
    expect(prefix).toBe(" ");
  });

  it("handles indicator with trailing space", () => {
    const { prefix } = buildTitleLine("◇", "task", "id123456", 25);
    expect(prefix).toBe("◇ ");
  });

  it("handles very narrow width without crashing", () => {
    const { prefix, paddedName, suffix } = buildTitleLine("○", "long name", "abcdef12", 5);
    const full = prefix + paddedName + suffix;
    // Should not crash; name gets truncated to nothing
    expect(full.length).toBe(Math.max(5, prefix.length + suffix.length));
  });
});
