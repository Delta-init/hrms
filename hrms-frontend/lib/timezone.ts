/** ISO (UTC) → value for <input type="datetime-local"> as wall-clock time in `tz`. */
export function toLocalInput(iso?: string | null, tz?: string): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
}

/** ISO → YYYY-MM-DD in `tz`, so a date prefill matches what list views show. */
export function toDateInput(iso?: string | null, tz?: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/**
 * ISO → HH:mm in `tz`, for a check-in/check-out field paired with its own
 * separate date field — the date is already on screen once, so the time
 * input has no business repeating it.
 */
export function toTimeInput(iso?: string | null, tz?: string): string {
  const local = toLocalInput(iso, tz);
  return local ? local.slice(11) : "";
}

/**
 * Attaches a bare "HH:mm" time to a "YYYY-MM-DD" date, rolling onto the next
 * calendar day when it reads at or before a reference time — the same rule
 * an overnight shift is resolved by on the server (see resolveShift). A
 * check-out of 03:00 against a check-in of 18:00 is the next morning, not
 * three in the afternoon turned backwards.
 */
export function combineDateAndTime(date: string, time: string, rollsAfter?: string): string {
  const day = rollsAfter !== undefined && time <= rollsAfter ? addDaysToDateInput(date, 1) : date;
  return `${day}T${time}`;
}

function addDaysToDateInput(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  // Constructed and read back in UTC on purpose — a local Date here would
  // shift the calendar day itself under a browser west of Greenwich.
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * "YYYY-MM-DDTHH:mm" (a <input type="datetime-local"> value, timezone-less) → ISO UTC,
 * interpreting the wall-clock value in `timeZone` rather than the browser's local zone.
 * `new Date(localString).toISOString()` would silently use the browser's zone instead of
 * the selected Time Region, producing a check-in/out time offset from what was entered.
 */
export function zonedInputToUtcIso(localDateTime: string | null | undefined, timeZone: string): string | null {
  if (!localDateTime) return null;
  const [datePart, timePart] = localDateTime.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mi] = timePart.split(":").map(Number);
  const asUTC = Date.UTC(y, m - 1, d, hh, mi);

  // Format that same instant as it would read in `timeZone`, then measure the
  // gap back to the UTC instant we started from — that gap is the zone's offset.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(asUTC));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour24 = get("hour") % 24; // Intl can format midnight as "24"
  const asIfUtcInZone = Date.UTC(get("year"), get("month") - 1, get("day"), hour24, get("minute"), get("second"));
  const offset = asUTC - asIfUtcInZone;

  return new Date(asUTC + offset).toISOString();
}
