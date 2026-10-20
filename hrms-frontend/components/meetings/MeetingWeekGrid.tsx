"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { MeetingBooking, MeetingRoom } from "@/types";
import { layoutLanes } from "./layoutLanes";

/**
 * A room's day, drawn to scale.
 *
 * A month grid can say a meeting happened on Tuesday; it cannot say whether
 * Tuesday at two is free, which is the only question anybody opens this page
 * to ask. So time runs down the side and a booking is a block whose height is
 * its length — the gaps between blocks are the answer.
 *
 * Bookings that overlap sit side by side rather than on top of each other:
 * with fifteen rooms and the LMS booking several pods at once, stacking them
 * turned a busy hour into unreadable text.
 */

/** The working window the grid draws. Anything outside it still exists; it is
 *  reachable by opening the booking rather than by scrolling to 4am. */
const FIRST_HOUR = 7;
const LAST_HOUR = 21;
const HOUR_PX = 56;
const MIN_BLOCK_PX = 18;
const GRID_PX = (LAST_HOUR - FIRST_HOUR) * HOUR_PX;

/** A day in the week view shows at most this many side-by-side columns; a
 *  busier moment shows three and a "+N more" that opens the By-room view. */
const MAX_LANES = 4;
/** Narrowest a side-by-side booking gets before the grid scrolls sideways. */
const LANE_MIN_PX = 76;
const DAY_MIN_PX = 90;
const ROOM_MIN_PX = 120;
const GUTTER_PX = 56;

const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => { const o = new Date(d); o.setDate(o.getDate() + n); return o; };
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
/** "14:30" — fits a narrow block where "02:30 PM" would be cut; the tooltip keeps the full reading. */
const hhmm24 = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const idOf = (v: unknown) => (v && typeof v === "object" ? String((v as { _id: string })._id) : String(v ?? ""));

/** Minutes from the top of the grid, clamped to the day's window: a booking
 *  that starts before it still shows where it reaches in, and one running past
 *  it — into the night, or over several days — stops at the bottom. */
function offsetPx(when: Date, day: Date) {
  const mins = (when.getTime() - startOfDay(day).getTime()) / 60_000 - FIRST_HOUR * 60;
  return (Math.min(Math.max(0, mins), (LAST_HOUR - FIRST_HOUR) * 60) / 60) * HOUR_PX;
}

const isElsewhere = (b: MeetingBooking) => b.mode === "online" || b.mode === "place";
const roomLabel = (b: MeetingBooking) =>
  b.mode === "online" ? "Online" : b.mode === "place" ? "Elsewhere" : typeof b.room === "object" && b.room ? b.room.name : "";
// Another system's booking (an LMS class pod) names whose it is itself.
const whoOf = (b: MeetingBooking) =>
  typeof b.organizer === "object" && b.organizer ? b.organizer.name : b.source?.label ?? "";

interface Column {
  key: string;
  heading: ReactNode;
  /** Hover text for the heading, when it may be cut short. */
  headingTitle?: string;
  day: Date;
  /** Already narrowed to this column — this day, or this room. */
  bookings: MeetingBooking[];
  minWidth: number;
  /** The column is one room, so a block need not repeat which. */
  roomIsColumn?: boolean;
  onPick?: (at: Date) => void;
  /** Set: a moment needing more than MAX_LANES columns folds into "+N more". */
  onMore?: () => void;
}

interface Block { b: MeetingBooking; top: number; height: number; lane: number; lanes: number }
interface MoreChip { key: string; top: number; height: number; lane: number; lanes: number; hidden: MeetingBooking[] }

/** Where each booking in a column goes, and how many lanes the column needs at its busiest. */
function placeColumn(col: Column): { blocks: Block[]; chips: MoreChip[]; widest: number } {
  const dayStart = startOfDay(col.day);
  const items = col.bookings.map((b) => {
    const top = Math.min(offsetPx(new Date(b.start), dayStart), GRID_PX - MIN_BLOCK_PX);
    const height = Math.max(MIN_BLOCK_PX, offsetPx(new Date(b.end), dayStart) - top);
    return { b, top, height };
  });
  // Laid out by what is drawn, so two short blocks padded to the minimum height don't collide either.
  const placed = layoutLanes(items.map((x) => ({ start: x.top, end: x.top + x.height })));

  const blocks: Block[] = [];
  const hiddenByCluster = new Map<number, typeof items>();
  let widest = 1;
  items.forEach((x, i) => {
    const p = placed[i]!;
    const folds = !!col.onMore && p.lanes > MAX_LANES;
    const lanes = folds ? MAX_LANES : p.lanes;
    widest = Math.max(widest, lanes);
    if (folds && p.lane >= MAX_LANES - 1) {
      const list = hiddenByCluster.get(p.cluster) ?? [];
      list.push(x);
      hiddenByCluster.set(p.cluster, list);
      return;
    }
    blocks.push({ ...x, lane: p.lane, lanes });
  });

  const chips: MoreChip[] = Array.from(hiddenByCluster.entries()).map(([cluster, list]) => {
    const top = Math.min(...list.map((x) => x.top));
    const bottom = Math.max(...list.map((x) => x.top + x.height));
    return {
      key: `more-${cluster}`,
      top,
      height: Math.max(MIN_BLOCK_PX, bottom - top),
      lane: MAX_LANES - 1,
      lanes: MAX_LANES,
      hidden: list.map((x) => x.b).sort((a, b) => a.start.localeCompare(b.start)),
    };
  });
  return { blocks, chips, widest };
}

/** Position inside the column: lane `lane` of `lanes`, with a small gutter between neighbours. */
function laneStyle(lane: number, lanes: number, top: number, height: number) {
  const inset = lanes === 1 ? 4 : 1;
  const share = 100 / lanes;
  return {
    top,
    height,
    left: `calc(${share * lane}% + ${inset}px)`,
    width: `calc(${share}% - ${inset * 2}px)`,
  };
}

function BookingBlock({ block, roomIsColumn, onSelect }: { block: Block; roomIsColumn?: boolean; onSelect: (b: MeetingBooking) => void }) {
  const { b, lane, lanes, top, height } = block;
  const room = roomLabel(b);
  const who = whoOf(b);
  const time = `${hhmm(b.start)}–${hhmm(b.end)}`;
  const tooltip = [b.title, time, room, who].filter(Boolean).join("\n");
  const narrow = lanes > 1;
  return (
    <button
      type="button"
      onClick={() => onSelect(b)}
      title={tooltip}
      style={laneStyle(lane, lanes, top, height)}
      className={cn(
        "absolute flex flex-col justify-start overflow-hidden rounded-md border border-primary/30 bg-primary/10 text-left hover:bg-primary/20",
        narrow ? "px-1 py-0.5 text-[11px] leading-tight" : "px-2 py-1 text-xs"
      )}
    >
      {narrow && !roomIsColumn && room ? (
        // Side by side, the room is what tells the blocks apart: it leads, the title follows.
        <>
          <span className="block truncate font-medium">{room}</span>
          <span className="block truncate text-[10px] tabular-nums text-muted-foreground">{hhmm24(b.start)}–{hhmm24(b.end)}</span>
          <span className="block truncate text-[10px] text-muted-foreground">{b.title}</span>
        </>
      ) : (
        <>
          <span className="block truncate font-medium">{b.title}</span>
          <span className={cn("block truncate text-muted-foreground", narrow ? "text-[10px]" : "text-[11px]")}>
            {time}{room && !roomIsColumn ? ` · ${room}` : ""}{who ? ` · ${who}` : ""}
          </span>
        </>
      )}
    </button>
  );
}

function TimeGrid({ columns, onSelect }: { columns: Column[]; onSelect: (b: MeetingBooking) => void }) {
  const laidOut = columns.map((c) => {
    const placed = placeColumn(c);
    return { col: c, ...placed, width: Math.max(c.minWidth, placed.widest * LANE_MIN_PX) };
  });
  const total = GUTTER_PX + laidOut.reduce((s, c) => s + c.width, 0);

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: Math.max(680, total) }}>
        {/* Headings */}
        <div className="flex border-b border-border">
          <div className="sticky left-0 z-20 shrink-0 bg-card" style={{ width: GUTTER_PX }} />
          {laidOut.map(({ col, width }) => (
            <div key={col.key} className="min-w-0 flex-1 px-2 py-2 text-center" style={{ minWidth: width }} title={col.headingTitle}>
              {col.heading}
            </div>
          ))}
        </div>

        <div className="flex">
          {/* Hour gutter — stays put when a busy grid scrolls sideways. */}
          <div className="sticky left-0 z-20 shrink-0 bg-card" style={{ width: GUTTER_PX }}>
            {HOURS.map((h) => (
              <div key={h} style={{ height: HOUR_PX }} className="relative">
                <span className="absolute -top-2 right-2 text-[11px] text-muted-foreground tabular-nums">
                  {String(h).padStart(2, "0")}:00
                </span>
              </div>
            ))}
          </div>

          {laidOut.map(({ col, blocks, chips, width }) => {
            const dayStart = startOfDay(col.day);
            return (
              <div key={col.key} className="relative min-w-0 flex-1 border-l border-border" style={{ height: GRID_PX, minWidth: width }}>
                {HOURS.map((h) => (
                  <div
                    key={h}
                    style={{ height: HOUR_PX }}
                    className="border-b border-border/60 transition-colors hover:bg-muted/40"
                    onClick={() => {
                      const at = new Date(dayStart);
                      at.setHours(h, 0, 0, 0);
                      col.onPick?.(at);
                    }}
                  />
                ))}

                {blocks.map((block) => (
                  <BookingBlock key={block.b._id} block={block} roomIsColumn={col.roomIsColumn} onSelect={onSelect} />
                ))}

                {chips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => col.onMore?.()}
                    title={`${chip.hidden.length} more at this time — opens the day by room\n${chip.hidden
                      .map((b) => `${hhmm(b.start)}–${hhmm(b.end)} · ${roomLabel(b) || b.title}`)
                      .join("\n")}`}
                    style={laneStyle(chip.lane, chip.lanes, chip.top, chip.height)}
                    className="absolute flex items-start justify-center overflow-hidden rounded-md border border-dashed border-primary/40 bg-muted/60 px-1 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/15"
                  >
                    +{chip.hidden.length} more
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface Props {
  days: Date[];
  bookings: MeetingBooking[];
  onSelect: (booking: MeetingBooking) => void;
  /** Clicking empty space starts a booking at that hour. */
  onPick?: (start: Date) => void;
  /** A day too busy to show side by side: "+N more" hands that day over, e.g. to the By-room view. */
  onMore?: (day: Date) => void;
}

/** One column per day. */
export function MeetingWeekGrid({ days, bookings, onSelect, onPick, onMore }: Props) {
  const columns: Column[] = days.map((day) => {
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);
    const today = dayStart.getTime() === startOfDay(new Date()).getTime();
    return {
      key: day.toISOString(),
      day,
      minWidth: DAY_MIN_PX,
      heading: (
        <>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {day.toLocaleDateString([], { weekday: "short" })}
          </p>
          <p className={cn("text-sm font-semibold", today && "text-primary")}>{day.getDate()}</p>
        </>
      ),
      // Anything overlapping this day, so a meeting spanning midnight
      // appears on both days rather than only the one it began on.
      bookings: bookings.filter((b) => new Date(b.start) < dayEnd && new Date(b.end) > dayStart),
      onPick,
      onMore: onMore ? () => onMore(day) : undefined,
    };
  });
  return <TimeGrid columns={columns} onSelect={onSelect} />;
}

type RoomLike = Pick<MeetingRoom, "_id" | "name"> & Partial<Pick<MeetingRoom, "location" | "capacity">>;

interface RoomDayProps {
  day: Date;
  /** The rooms to draw, in order — already narrowed by the page's room filter. */
  rooms: RoomLike[];
  bookings: MeetingBooking[];
  onSelect: (booking: MeetingBooking) => void;
  /** Clicking empty space starts a booking at that hour; `room` is null in the online/elsewhere column. */
  onPick?: (start: Date, room: string | null) => void;
}

/** One day, one column per room — which pod is free at two is a glance, not a hunt. */
export function MeetingRoomDayGrid({ day, rooms, bookings, onSelect, onPick }: RoomDayProps) {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const onThisDay = bookings.filter((b) => new Date(b.start) < dayEnd && new Date(b.end) > dayStart);

  // A booking in a room no longer on the list (since retired) still gets a column.
  const known = new Set(rooms.map((r) => r._id));
  const extra = new Map<string, RoomLike>();
  for (const b of onThisDay) {
    if (isElsewhere(b)) continue;
    const id = idOf(b.room);
    if (id && !known.has(id) && !extra.has(id)) {
      extra.set(id, typeof b.room === "object" && b.room ? b.room : { _id: id, name: "Other room" });
    }
  }

  const columns: Column[] = [...rooms, ...Array.from(extra.values())].map((r) => {
    const sub = [r.location, r.capacity ? `${r.capacity} seats` : ""].filter(Boolean).join(" · ");
    return {
      key: r._id,
      day,
      minWidth: ROOM_MIN_PX,
      roomIsColumn: true,
      headingTitle: [r.name, sub].filter(Boolean).join(" — "),
      heading: (
        <>
          <p className="truncate text-sm font-semibold">{r.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{sub || " "}</p>
        </>
      ),
      bookings: onThisDay.filter((b) => !isElsewhere(b) && idOf(b.room) === r._id),
      onPick: onPick ? (at: Date) => onPick(at, r._id) : undefined,
    };
  });

  const elsewhere = onThisDay.filter((b) => isElsewhere(b) || !idOf(b.room));
  if (elsewhere.length) {
    columns.push({
      key: "__elsewhere__",
      day,
      minWidth: ROOM_MIN_PX,
      headingTitle: "Online and off-site meetings",
      heading: (
        <>
          <p className="truncate text-sm font-semibold">Online / elsewhere</p>
          <p className="truncate text-[11px] text-muted-foreground">No room</p>
        </>
      ),
      bookings: elsewhere,
      onPick: onPick ? (at: Date) => onPick(at, null) : undefined,
    });
  }

  return <TimeGrid columns={columns} onSelect={onSelect} />;
}
