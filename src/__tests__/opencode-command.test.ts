import { DEFAULT_COMMANDS } from "../board/types.js";

import { describe, it, expect } from "vitest";

describe("DEFAULT_COMMANDS", () => {
  it("includes opencode", () => {
    const ids = DEFAULT_COMMANDS.map(c => c.id);
    expect(ids).toContain("opencode");
  });
});
