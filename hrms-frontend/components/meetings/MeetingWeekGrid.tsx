"use client";
import { cn } from "@/lib/utils";
import type { MeetingBooking } from "@/types";

/**
 * A room's day, drawn to scale.
 *
 * A month grid can say a meeting happened on Tuesday; it cannot say whether
 * Tuesday at two is free, which is the only question anybody opens this page
 * to ask. So time runs down the side and a booking is a block whose height is
 * its length — the gaps between blocks are the answer.
 */

/** The working window the grid draws. Anything outside it still exists; it is
 *  reachable by opening the booking rather than by scrolling to 4am. */
const FIRST_HOUR = 7;
const LAST_HOUR = 21;
const HOUR_PX = 56;

const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => { const o = new Date(d); o.setDate(o.getDate() + n); return o; };
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Minutes from the top of the grid, clamped so a booking that starts before
 *  the window still shows where it reaches into it. */
function offsetPx(when: Date, day: Date) {
  const mins = (when.getTime() - startOfDay(day).getTime()) / 60_000 - FIRST_HOUR * 60;
  return (Math.max(0, mins) / 60) * HOUR_PX;
}

interface Props {
  days: Date[];
  bookings: MeetingBooking[];
  onSelect: (booking: MeetingBooking) => void;
  /** Clicking empty space starts a booking at that hour. */
  onPick?: (start: Date) => void;
}

export function MeetingWeekGrid({ days, bookings, onSelect, onPick }: Props) {
  const height = HOURS.length * HOUR_PX;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[680px]">
        {/* Day headings */}
        <div className="flex border-b border-border">
          <div className="w-14 shrink-0" />
          {days.map((d) => {
            const today = startOfDay(d).getTime() === startOfDay(new Date()).getTime();
            return (
              <div key={d.toISOString()} className="flex-1 px-2 py-2 text-center">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {d.toLocaleDateString([], { weekday: "short" })}
                </p>
                <p className={cn("text-sm font-semibold", today && "text-primary")}>
                  {d.getDate()}
                </p>
              </div>
            );
          })}
        </div>

        <div className="flex">
          {/* Hour gutter */}
          <div className="w-14 shrink-0">
            {HOURS.map((h) => (
              <div key={h} style={{ height: HOUR_PX }} className="relative">
                <span className="absolute -top-2 right-2 text-[11px] text-muted-foreground tabular-nums">
                  {String(h).padStart(2, "0")}:00
                </span>
              </div>
            ))}
          </div>

          {days.map((day) => {
            const dayStart = startOfDay(day);
            const dayEnd = addDays(dayStart, 1);
            // Anything overlapping this day, so a meeting spanning midnight
            // appears on both days rather than only the one it began on.
            const onThisDay = bookings.filter(
              (b) => new Date(b.start) < dayEnd && new Date(b.end) > dayStart
            );

            return (
              <div key={day.toISOString()} className="relative flex-1 border-l border-border" style={{ height }}>
                {HOURS.map((h) => (
                  <div
                    key={h}
                    style={{ height: HOUR_PX }}
                    className="border-b border-border/60 transition-colors hover:bg-muted/40"
                    onClick={() => {
                      const at = new Date(dayStart);
                      at.setHours(h, 0, 0, 0);
                      onPick?.(at);
                    }}
                  />
                ))}

                {onThisDay.map((b) => {
                  const top = offsetPx(new Date(b.start), day);
                  const bottom = offsetPx(new Date(b.end), day);
                  const room = typeof b.room === "object" && b.room ? b.room.name : "";
                  const who = typeof b.organizer === "object" && b.organizer ? b.organizer.name : "";
                  return (
                    <button
                      key={b._id}
                      type="button"
                      onClick={() => onSelect(b)}
                      style={{ top, height: Math.max(18, bottom - top) }}
                      className="absolute inset-x-1 overflow-hidden rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-left text-xs hover:bg-primary/20"
                    >
                      <span className="block truncate font-medium">{b.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {hhmm(b.start)}–{hhmm(b.end)}{room ? ` · ${room}` : ""}{who ? ` · ${who}` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
