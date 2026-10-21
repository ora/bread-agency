/**
 * Pickup slots: the requested time if the oven has room, otherwise the
 * nearest open slot after it, inside pickup hours and the order window.
 */

import { BUSINESS } from "@/lib/menu";
import type { PickupRequest } from "./parse";
import { addLocalDays, fromLocal, localParts } from "./time";

/** How many slots to consider; enough for a full day and a half. */
const CANDIDATE_LIMIT = 24;

export function slotKey(slot: Date): string {
  return `slot:${slot.toISOString()}`;
}

/** The instant the customer asked for, if they named one. */
export function requestedInstant(pickup: PickupRequest, now: Date): Date | undefined {
  const tz = BUSINESS.timeZone;
  if (pickup.instant) return pickup.instant;
  if (pickup.date && pickup.minutes !== undefined) return fromLocal(pickup.date, pickup.minutes, tz);
  if (pickup.date) return fromLocal(pickup.date, BUSINESS.opensAtMinutes, tz);
  if (pickup.minutes !== undefined) {
    const today = fromLocal(addLocalDays(now, 0, tz), pickup.minutes, tz);
    return today.getTime() >= earliest(now).getTime() ? today : fromLocal(addLocalDays(now, 1, tz), pickup.minutes, tz);
  }
  return undefined;
}

/** Days since the epoch of the local calendar date, for whole-day differences. */
function localDayNumber(date: Date): number {
  const p = localParts(date, BUSINESS.timeZone);
  return Date.UTC(p.year, p.month - 1, p.day) / 86_400_000;
}

function earliest(now: Date): Date {
  return new Date(now.getTime() + BUSINESS.leadMinutes * 60_000);
}

/** Open slots at or after the requested time (or the earliest possible), in order. */
export function candidateSlots(pickup: PickupRequest, now: Date): Date[] {
  const tz = BUSINESS.timeZone;
  const floor = Math.max(earliest(now).getTime(), requestedInstant(pickup, now)?.getTime() ?? 0);
  const startOffset = localDayNumber(new Date(floor)) - localDayNumber(now);

  const slots: Date[] = [];
  for (let day = Math.max(0, startOffset); day <= BUSINESS.orderWindowDays && slots.length < CANDIDATE_LIMIT; day++) {
    const date = addLocalDays(now, day, tz);
    for (
      let minutes = BUSINESS.opensAtMinutes;
      minutes + BUSINESS.slotMinutes <= BUSINESS.closesAtMinutes && slots.length < CANDIDATE_LIMIT;
      minutes += BUSINESS.slotMinutes
    ) {
      const slot = fromLocal(date, minutes, tz);
      if (slot.getTime() >= floor) slots.push(slot);
    }
  }
  return slots;
}

/** The first candidate with room for `pizzas`, given how many each already holds. */
export function pickSlot(candidates: Date[], reserved: number[], pizzas: number): Date | undefined {
  return candidates.find((_, i) => (reserved[i] ?? 0) + pizzas <= BUSINESS.pizzasPerSlot);
}
