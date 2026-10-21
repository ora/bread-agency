/**
 * Local-time arithmetic for one IANA time zone, with only `Intl`. Pickup slots
 * are wall-clock times at the shop, so every conversion goes through here.
 */

export interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number;
}

export interface LocalDateTime extends LocalDate {
  hour: number;
  minute: number;
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function localParts(date: Date, timeZone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

/** The zone's offset from UTC at `date`, in minutes (New York in summer: -240). */
function offsetMinutes(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const truncated = Math.floor(date.getTime() / 60_000) * 60_000;
  return Math.round((asUtc - truncated) / 60_000);
}

/** The instant a wall-clock time in `timeZone` names. */
export function fromLocal(local: LocalDate, minutesOfDay: number, timeZone: string): Date {
  const guess = Date.UTC(local.year, local.month - 1, local.day, 0, minutesOfDay);
  // Two passes settle the offset on either side of a daylight-saving change.
  let instant = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  instant = guess - offsetMinutes(new Date(instant), timeZone) * 60_000;
  return new Date(instant);
}

/** The local calendar date `days` after the local date of `date`. */
export function addLocalDays(date: Date, days: number, timeZone: string): LocalDate {
  const p = localParts(date, timeZone);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** RFC 3339 with the zone's own offset, e.g. 2026-10-22T19:00:00-04:00. */
export function isoLocal(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  const offset = offsetMinutes(date, timeZone);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** "Thursday, October 22 at 7:00 PM". */
export function describeLocal(date: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
  return `${day} at ${time}`;
}
