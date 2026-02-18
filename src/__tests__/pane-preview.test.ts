import { describe, it, expect } from "vitest";
import { extractPreviewLines, buildPreviewMap } from "../board/pane-preview.js";

describe("extractPreviewLines", () => {
  it("returns last N non-blank lines", () => {
    const content = "line1\nline2\n\n\nline3\nline4\n\n";
    expect(extractPreviewLines(content, 2)).toEqual(["line3", "line4"]);
  });

  it("returns empty array for blank content", () => {
    expect(extractPreviewLines("\n\n  \n")).toEqual([]);
  });

  it("trims trailing whitespace from lines", () => {
    const content = "hello   \nworld  \n";
    expect(extractPreviewLines(content, 3)).toEqual(["hello", "world"]);
  });

  it("respects maxLines parameter", () => {
    const content = "a\nb\nc\nd\ne\n";
    expect(extractPreviewLines(content, 3)).toEqual(["c", "d", "e"]);
  });

  it("returns all lines if fewer than maxLines", () => {
    expect(extractPreviewLines("one\ntwo\n", 5)).toEqual(["one", "two"]);
  });
});

describe("buildPreviewMap", () => {
  it("builds windowId map from pane contents", () => {
    const contents = new Map([
      ["%0", "hello\nworld\n"],
      ["%1", "foo\n"],
    ]);
    const paneToWindow = new Map([
      ["%0", "@0"],
      ["%1", "@1"],
    ]);
    const result = buildPreviewMap(contents, paneToWindow);
    expect(result.get("@0")).toEqual(["hello", "world"]);
    expect(result.get("@1")).toEqual(["foo"]);
  });

  it("skips panes with no window mapping", () => {
    const contents = new Map([["%99", "orphan\n"]]);
    const paneToWindow = new Map<string, string>();
    const result = buildPreviewMap(contents, paneToWindow);
    expect(result.size).toBe(0);
  });

  it("uses first pane for multi-pane windows", () => {
    const contents = new Map([
      ["%0", "first\n"],
      ["%1", "second\n"],
    ]);
    const paneToWindow = new Map([
      ["%0", "@0"],
      ["%1", "@0"],
    ]);
    const result = buildPreviewMap(contents, paneToWindow);
    expect(result.get("@0")).toEqual(["first"]);
  });
});
