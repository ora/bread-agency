import { describe, expect, it } from "vitest";
import { candidateSlots, pickSlot, requestedInstant } from "@/lib/agent/slots";
import { NOW } from "./fakes";

describe("slots", () => {
  it("starts at the requested time when it is inside pickup hours", () => {
    const pickup = { date: { year: 2026, month: 10, day: 22 }, minutes: 19 * 60 };
    expect(candidateSlots(pickup, NOW)[0]?.toISOString()).toBe("2026-10-22T23:00:00.000Z");
  });

  it("moves a time after closing to the next day's opening", () => {
    const pickup = { date: { year: 2026, month: 10, day: 22 }, minutes: 23 * 60 };
    // Friday 5:00 PM New York.
    expect(candidateSlots(pickup, NOW)[0]?.toISOString()).toBe("2026-10-23T21:00:00.000Z");
  });

  it("offers today's opening when nothing was asked and there is lead time", () => {
    // NOW is 4:00 PM; the 30-minute lead still allows 5:00 PM today.
    expect(candidateSlots({}, NOW)[0]?.toISOString()).toBe("2026-10-21T21:00:00.000Z");
  });

  it("reads a time alone as today, or tomorrow once it has passed", () => {
    expect(requestedInstant({ minutes: 18 * 60 }, NOW)?.toISOString()).toBe("2026-10-21T22:00:00.000Z");
    expect(requestedInstant({ minutes: 16 * 60 }, NOW)?.toISOString()).toBe("2026-10-22T20:00:00.000Z");
  });

  it("skips a slot without room for the whole order", () => {
    const candidates = candidateSlots({ date: { year: 2026, month: 10, day: 22 }, minutes: 19 * 60 }, NOW);
    expect(pickSlot(candidates, [5, 0], 2)).toBe(candidates[1]);
    expect(pickSlot(candidates, [4, 0], 2)).toBe(candidates[0]);
  });

  it("handles the daylight-saving change", () => {
    // Clocks go back on 2026-11-01; 7 PM that evening is EST (UTC-5).
    const pickup = { date: { year: 2026, month: 11, day: 1 }, minutes: 19 * 60 };
    const now = new Date("2026-10-30T16:00:00Z");
    expect(candidateSlots(pickup, now)[0]?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });
});
