import { describe, it, expect } from "vitest";
import { checkIdle } from "../cli.js";

describe("checkIdle", () => {
  it("returns null when below threshold", () => {
    const lastChangeAt = 1000;
    const now = 2500;
    expect(checkIdle(lastChangeAt, now, 3000)).toBeNull();
  });

  it("returns idleMs at exact threshold", () => {
    const lastChangeAt = 1000;
    const now = 4000;
    expect(checkIdle(lastChangeAt, now, 3000)).toBe(3000);
  });

  it("returns idleMs when exceeding threshold", () => {
    const lastChangeAt = 1000;
    const now = 5500;
    expect(checkIdle(lastChangeAt, now, 3000)).toBe(4500);
  });

  it("resets after simulated hash change", () => {
    // Simulate: idle for 4s, then hash change resets lastChangeAt
    let lastChangeAt = 1000;
    expect(checkIdle(lastChangeAt, 5000, 3000)).toBe(4000); // idle

    // Hash change at t=5000 resets the timer
    lastChangeAt = 5000;
    expect(checkIdle(lastChangeAt, 5500, 3000)).toBeNull(); // not idle yet

    // Idle again after 3s from the reset
    expect(checkIdle(lastChangeAt, 8000, 3000)).toBe(3000);
  });

  it("re-fires on subsequent ticks while idle", () => {
    const lastChangeAt = 1000;
    // tick 1: 4000 → idle 3000ms
    expect(checkIdle(lastChangeAt, 4000, 3000)).toBe(3000);
    // tick 2: 4500 → idle 3500ms
    expect(checkIdle(lastChangeAt, 4500, 3000)).toBe(3500);
    // tick 3: 5000 → idle 4000ms
    expect(checkIdle(lastChangeAt, 5000, 3000)).toBe(4000);
  });
});
