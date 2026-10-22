"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5055/api/v1";
const REFRESH_MS = 30_000;
/** How long each page of bookings stays up before the next. */
const PAGE_MS = 10_000;
const SOON_MS = 15 * 60_000;
const ROTATIONS = [0, 90, 180, 270] as const;
type Rotation = (typeof ROTATIONS)[number];
const ROTATION_KEY = "meeting-board-rotation";

/** ?rotate=90 in the link, else what this screen last chose, else upright. */
function initialRotation(): Rotation {
  const q = new URLSearchParams(window.location.search);
  const fromUrl = Number(q.get("rotate"));
  if (q.has("rotate") && (ROTATIONS as readonly number[]).includes(fromUrl)) return fromUrl as Rotation;
  try {
    const saved = Number(localStorage.getItem(ROTATION_KEY));
    if ((ROTATIONS as readonly number[]).includes(saved)) return saved as Rotation;
  } catch { /* storage blocked — upright */ }
  return 0;
}

interface BoardRow {
  id: string;
  title: string;
  organiser: string;
  room: string;
  start: string;
  end: string;
  cancelled: boolean;
}
interface Board {
  organization: string;
  timeZone: string;
  rooms: string[];
  bookings: BoardRow[];
}

type Tone = "sched" | "soon" | "live" | "ended" | "cancelled";
type Status = { label: string; tone: Tone; note: string };

const mins = (ms: number) => Math.max(1, Math.round(ms / 60_000));

function statusOf(b: BoardRow, now: number): Status {
  const start = new Date(b.start).getTime(), end = new Date(b.end).getTime();
  if (b.cancelled) return { label: "Cancelled", tone: "cancelled", note: "" };
  if (now >= end) return { label: "Ended", tone: "ended", note: "" };
  if (now >= start) return { label: "In progress", tone: "live", note: `${mins(end - now)} min left` };
  if (start - now <= SOON_MS) return { label: "Starting soon", tone: "soon", note: `in ${mins(start - now)} min` };
  return { label: "Scheduled", tone: "sched", note: "" };
}

const TONE: Record<Tone, string> = {
  sched: "text-[#ece6d6]",
  soon: "text-[#ffb81c] motion-safe:animate-pulse",
  live: "text-[#3ee089]",
  ended: "text-[#5c6675]",
  cancelled: "text-[#ff5d50]",
};

/** Where a room stands right now: taken, about to be, or free. */
function roomState(room: string, bookings: BoardRow[], now: number): { state: "busy" | "soon" | "free"; at: string | null } {
  const live = bookings.filter((b) => b.room === room && !b.cancelled);
  const current = live.find((b) => new Date(b.start).getTime() <= now && now < new Date(b.end).getTime());
  if (current) return { state: "busy", at: current.end };
  const next = live.find((b) => new Date(b.start).getTime() > now && new Date(b.start).getTime() - now <= SOON_MS);
  if (next) return { state: "soon", at: next.start };
  return { state: "free", at: null };
}

/**
 * The public meeting board, at a plain address: today's room and pod bookings
 * for a screen in the lobby — landscape or turned on its side — or a phone.
 *
 * At the top, every room and whether it is free right now; below, the day's
 * bookings as a departures list. On a wide screen that list is a table; on a
 * portrait screen or a phone each booking is a card, so the room and its
 * status are never pushed off the edge. Sizes follow the screen, so the same
 * page reads from across a room on a TV and up close on a phone.
 *
 * A TV hung on its side often cannot turn its own picture, so the board turns
 * itself: the rotate button (or ?rotate=90 in the link) turns everything a
 * quarter at a time, and the layout follows the way the board now faces. The
 * choice is remembered by that screen. The button hides when the mouse is still.
 */
export default function MeetingBoardPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [offline, setOffline] = useState(false);
  const [updated, setUpdated] = useState<number | null>(null);
  // Null until mounted: the server's time is not the screen's, and rendering it
  // there would only be replaced, with a mismatch, a moment later.
  const [mounted, setMounted] = useState<number | null>(null);
  const now = mounted ?? 0;

  const [rotation, setRotation] = useState<Rotation>(0);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [showControls, setShowControls] = useState(true);

  useEffect(() => {
    setRotation(initialRotation());
    const size = () => setView({ w: window.innerWidth, h: window.innerHeight });
    size();
    window.addEventListener("resize", size);
    return () => window.removeEventListener("resize", size);
  }, []);

  const rotate = useCallback(() => {
    setRotation((r) => {
      const next = ROTATIONS[(ROTATIONS.indexOf(r) + 1) % ROTATIONS.length];
      try { localStorage.setItem(ROTATION_KEY, String(next)); } catch { /* not remembered */ }
      return next;
    });
  }, []);

  // The button shows while the mouse moves (or on a tap), and fades after a few seconds.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setShowControls(true);
      clearTimeout(t);
      t = setTimeout(() => setShowControls(false), 4000);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "r" || e.key === "R") rotate(); };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("touchstart", wake);
    window.addEventListener("keydown", key);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("touchstart", wake);
      window.removeEventListener("keydown", key);
    };
  }, [rotate]);

  useEffect(() => {
    setMounted(Date.now());
    const t = setInterval(() => setMounted(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/meetings/board`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { data: Board };
        if (!live) return;
        setBoard(body.data);
        setOffline(false);
        setUpdated(Date.now());
      } catch {
        // Keep showing the last board; say it is not current.
        if (live) setOffline(true);
      }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { live = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    document.title = board ? `Meeting rooms · ${board.organization}` : "Meeting rooms";
  }, [board]);

  const tz = board?.timeZone || undefined;
  const hm = (d: string | number) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(d));
  const clock = mounted ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(now) : "--:--";
  const seconds = mounted ? new Intl.DateTimeFormat("en-GB", { second: "2-digit", timeZone: tz }).format(now).padStart(2, "0") : "--";
  const today = mounted ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(now) : "";

  const rooms = (board?.rooms ?? []).map((name) => ({ name, ...roomState(name, board?.bookings ?? [], now) }));
  const free = rooms.filter((r) => r.state === "free").length;
  const busy = rooms.filter((r) => r.state === "busy").length;
  const upcoming = board?.bookings ?? [];

  /**
   * Pages, sized to the screen: as many bookings as fit below the rooms, the
   * rest on further pages that turn by themselves. Measured rather than fixed,
   * so a big TV shows more per page than a small one, and a turn to portrait
   * re-fits. Where not even two fit — a phone — the list just scrolls.
   */
  const listArea = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const count = upcoming.length;
  useLayoutEffect(() => { setPageSize(null); }, [count, view.w, view.h, rotation]);
  useLayoutEffect(() => {
    if (pageSize !== null || !count) return;
    const area = listArea.current;
    // The rows of whichever list is showing — the other is display:none and measures 0.
    // Sized by the tallest, so a page never ends on a row cut in half.
    const rows = Array.from(area?.querySelectorAll<HTMLElement>("[data-row]") ?? []).filter((el) => el.offsetHeight > 0);
    const row = rows[0];
    if (!area || !row) return;
    const tallest = Math.max(...rows.map((el) => el.offsetHeight));
    const list = row.parentElement!;
    const css = getComputedStyle(list.tagName === "TBODY" ? list.closest("table")! : list);
    const gap = list.tagName === "TBODY" ? parseFloat(css.borderSpacing.split(" ")[1] ?? "0") || 0 : parseFloat(css.rowGap) || 0;
    const head = area.querySelector<HTMLElement>("thead")?.offsetHeight ?? 0;
    const fits = Math.floor((area.clientHeight - head + gap) / (tallest + gap));
    setPageSize(fits >= 2 ? fits : Infinity);
  }, [pageSize, count, board]);
  const size = pageSize ?? Infinity;
  const pages = Number.isFinite(size) ? Math.max(1, Math.ceil(count / size)) : 1;
  useEffect(() => { if (page >= pages) setPage(0); }, [page, pages]);
  useEffect(() => {
    if (pages <= 1) return;
    const t = setInterval(() => setPage((p) => (p + 1) % pages), PAGE_MS);
    return () => clearInterval(t);
  }, [pages]);
  const shown = Number.isFinite(size) ? upcoming.slice(page * size, page * size + size) : upcoming;

  // The board's own shape once turned: a quarter turn swaps width and height.
  const sideways = rotation === 90 || rotation === 270;
  const boardW = sideways ? view.h : view.w;
  const boardH = sideways ? view.w : view.h;
  const orient = boardH > boardW ? "portrait" : "landscape";
  const layout = orient === "landscape" && boardW >= 640 ? "table" : "cards";
  const wide = boardW >= 768;

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#07090d]">
    <div
      className="group absolute left-1/2 top-1/2 overflow-y-auto"
      data-orient={orient}
      data-layout={layout}
      data-wide={wide}
      style={{
        width: view.w ? boardW : "100vw",
        height: view.h ? boardH : "100vh",
        transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
      }}
    >
    <main className="flex h-full flex-col gap-[clamp(1rem,2.5vmin,2rem)] bg-[#07090d] px-[clamp(1rem,3vmin,3rem)] py-[clamp(1rem,3vmin,2.5rem)] font-mono text-[#ece6d6]">
      {/* ── Header: where, and the time — the clock leads on a portrait screen ── */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-[#ffb81c] pb-[clamp(0.75rem,2vmin,1.5rem)] group-data-[orient=portrait]:flex-col-reverse group-data-[orient=portrait]:items-start">
        <div>
          <p className="text-[clamp(0.65rem,1.4vmin,0.9rem)] uppercase tracking-[0.35em] text-[#ffb81c]">Meeting rooms · Today</p>
          <h1 className="mt-1 text-[clamp(1.4rem,4.2vmin,3.5rem)] font-bold uppercase leading-tight tracking-wider">{board?.organization ?? "Meeting rooms"}</h1>
        </div>
        <div className="group-data-[orient=landscape]:text-right">
          <p className="font-bold tabular-nums leading-none text-[#ffb81c]">
            <span className="text-[clamp(2.5rem,9vmin,7rem)]">{clock}</span>
            <span className="ml-1 text-[clamp(1rem,3vmin,2.5rem)] text-[#a07a1c]">{seconds}</span>
          </p>
          <p className="mt-1 text-[clamp(0.7rem,1.6vmin,1.1rem)] uppercase tracking-[0.25em] text-[#8a93a3]">{today || "\u00a0"}</p>
        </div>
      </header>

      {!board ? (
        <p className={`py-24 text-center text-sm uppercase tracking-[0.3em] ${offline ? "text-[#ff5d50]" : "text-[#8a93a3] motion-safe:animate-pulse"}`}>
          {offline ? "Can't reach the server — retrying" : "Loading…"}
        </p>
      ) : (
        <>
          {/* ── Every room, free or taken, right now ── */}
          {rooms.length > 0 && (
            <section>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 uppercase">
                <span className="text-[clamp(1rem,2.6vmin,2rem)] font-bold text-[#3ee089]"><span className="tabular-nums">{free}</span> free now</span>
                <span className="text-[clamp(1rem,2.6vmin,2rem)] font-bold text-[#ff5d50]"><span className="tabular-nums">{busy}</span> in use</span>
              </div>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(clamp(8.5rem,17vmin,13rem),1fr))] gap-[clamp(0.35rem,0.9vmin,0.75rem)]">
                {rooms.map((r) => (
                  <li key={r.name}
                    className={`flex min-w-0 flex-col rounded-md border px-3 py-[clamp(0.4rem,1.1vmin,0.9rem)] uppercase ${
                      r.state === "busy" ? "border-[#ff5d50]/40 bg-[#ff5d50]/10" : r.state === "soon" ? "border-[#ffb81c]/40 bg-[#ffb81c]/10" : "border-[#3ee089]/35 bg-[#3ee089]/10"}`}>
                    <span className="break-words text-[clamp(0.8rem,1.9vmin,1.4rem)] font-bold leading-tight tracking-wider">{r.name}</span>
                    <span className={`text-[clamp(0.6rem,1.3vmin,0.95rem)] tracking-widest ${r.state === "busy" ? "text-[#ff5d50]" : r.state === "soon" ? "text-[#ffb81c]" : "text-[#3ee089]"}`}>
                      {r.at ? `${r.state === "busy" ? "till" : "at"} ${hm(r.at)}` : "free"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Today's bookings ── */}
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[clamp(0.65rem,1.4vmin,0.9rem)] uppercase tracking-[0.35em] text-[#ffb81c]">Bookings</p>
              {pages > 1 && (
                <div className="flex items-center gap-3" aria-label={`Page ${page + 1} of ${pages}`}>
                  <span className="text-[clamp(0.6rem,1.3vmin,0.9rem)] uppercase tracking-[0.25em] text-[#8a93a3] tabular-nums">Page {page + 1} of {pages}</span>
                  <span className="flex gap-1.5">
                    {Array.from({ length: pages }, (_, i) => (
                      <span key={i} className={`h-[clamp(0.35rem,0.8vmin,0.6rem)] rounded-full transition-all duration-500 ${i === page ? "w-[clamp(1rem,2.4vmin,1.8rem)] bg-[#ffb81c]" : "w-[clamp(0.35rem,0.8vmin,0.6rem)] bg-[#2a323e]"}`} />
                    ))}
                  </span>
                </div>
              )}
            </div>
            <div ref={listArea} className={`min-h-0 flex-1 ${Number.isFinite(size) ? "overflow-hidden" : "overflow-y-auto"}`}>
            {upcoming.length === 0 ? (
              <p className="py-16 text-center text-[clamp(1rem,2.4vmin,1.6rem)] uppercase tracking-[0.3em] text-[#8a93a3]">No meetings booked for the rest of today</p>
            ) : (
              <>
                {/* Portrait screens and phones: a card per booking. */}
                <ul key={`c${page}`} className="grid gap-[clamp(0.4rem,1vmin,0.8rem)] motion-safe:animate-fade-in group-data-[layout=table]:hidden">
                  {shown.map((b) => {
                    const s = statusOf(b, now);
                    const faded = s.tone === "ended" || s.tone === "cancelled";
                    return (
                      <li key={b.id} data-row className={`rounded-lg border-l-4 bg-[#10151d] px-[clamp(0.75rem,2vmin,1.5rem)] py-[clamp(0.6rem,1.6vmin,1.2rem)] uppercase ${faded ? "opacity-55" : ""} ${
                        s.tone === "live" ? "border-[#3ee089]" : s.tone === "soon" ? "border-[#ffb81c]" : s.tone === "cancelled" ? "border-[#ff5d50]" : "border-[#2a323e]"}`}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[clamp(1rem,2.6vmin,2rem)] font-bold tabular-nums text-[#ffb81c]">{hm(b.start)}<span className="text-[#8a93a3]">–{hm(b.end)}</span></span>
                          <span className={`text-right text-[clamp(0.8rem,2vmin,1.5rem)] font-bold tracking-wider ${TONE[s.tone]}`}>
                            {s.label}
                            {s.note && <span className="block text-[clamp(0.6rem,1.3vmin,0.95rem)] font-normal tracking-widest text-[#8a93a3]">{s.note}</span>}
                          </span>
                        </div>
                        <p className={`mt-1 truncate text-[clamp(1rem,2.5vmin,1.9rem)] tracking-wide ${s.tone === "cancelled" ? "line-through" : ""}`}>{b.title}</p>
                        <p className="mt-0.5 truncate text-[clamp(0.75rem,1.8vmin,1.35rem)] tracking-wider text-[#b9b4a6]">
                          <span className="font-bold text-[#ece6d6]">{b.room}</span>{b.organiser ? ` · ${b.organiser}` : ""}
                        </p>
                      </li>
                    );
                  })}
                </ul>

                {/* Landscape screens: a departures table. */}
                <div className="hidden overflow-x-auto group-data-[layout=table]:block">
                  <table className="w-full border-separate border-spacing-y-[clamp(0.3rem,0.8vmin,0.6rem)] text-left">
                    <thead>
                      <tr className="text-[clamp(0.6rem,1.3vmin,0.9rem)] uppercase tracking-[0.25em] text-[#8a93a3]">
                        <th className="px-3 py-1 font-normal">Time</th>
                        <th className="px-3 py-1 font-normal">Meeting</th>
                        <th className="hidden px-3 py-1 font-normal group-data-[wide=true]:table-cell">Booked by</th>
                        <th className="px-3 py-1 font-normal">Room</th>
                        <th className="px-3 py-1 text-right font-normal">Status</th>
                      </tr>
                    </thead>
                    <tbody key={`t${page}`} className="motion-safe:animate-fade-in">
                      {shown.map((b) => {
                        const s = statusOf(b, now);
                        const faded = s.tone === "ended" || s.tone === "cancelled";
                        return (
                          <tr key={b.id} data-row className={`bg-[#10151d] text-[clamp(0.85rem,2vmin,1.6rem)] uppercase ${faded ? "opacity-55" : ""}`}>
                            <td className={`whitespace-nowrap rounded-l-md border-l-4 px-3 py-[clamp(0.6rem,1.5vmin,1.1rem)] font-bold tabular-nums text-[#ffb81c] ${
                              s.tone === "live" ? "border-[#3ee089]" : s.tone === "soon" ? "border-[#ffb81c]" : s.tone === "cancelled" ? "border-[#ff5d50]" : "border-transparent"}`}>
                              {hm(b.start)}<span className="text-[#8a93a3]">–{hm(b.end)}</span>
                            </td>
                            <td className={`max-w-[32ch] truncate px-3 tracking-wide ${s.tone === "cancelled" ? "line-through" : ""}`}>{b.title}</td>
                            <td className="hidden max-w-[22ch] truncate px-3 text-[#b9b4a6] group-data-[wide=true]:table-cell">{b.organiser || "—"}</td>
                            <td className="whitespace-nowrap px-3 font-bold tracking-wider">{b.room}</td>
                            <td className="whitespace-nowrap rounded-r-md px-3 text-right">
                              <span className={`font-bold tracking-wider ${TONE[s.tone]}`}>{s.label}</span>
                              {s.note && <span className="block text-[clamp(0.6rem,1.2vmin,0.9rem)] tracking-widest text-[#8a93a3]">{s.note}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            </div>
          </section>
        </>
      )}

      <footer className="flex flex-wrap justify-between gap-2 text-[clamp(0.6rem,1.2vmin,0.85rem)] uppercase tracking-[0.2em] text-[#5c6675]">
        <span>{offline && board ? <span className="text-[#ff5d50]">Connection lost — showing the last update</span> : "Refreshes every 30 seconds"}</span>
        {updated && <span>Updated {hm(updated)}</span>}
      </footer>
    </main>
    </div>

      {/* Turn the board for a screen hung on its side. Hidden while the mouse is still. */}
      <button
        type="button"
        onClick={rotate}
        aria-label={`Rotate the board (now ${rotation}°)`}
        title="Rotate (R)"
        className={`fixed bottom-4 right-4 z-10 flex items-center gap-2 rounded-full border border-[#ffb81c]/40 bg-[#10151d]/90 px-4 py-2 font-mono text-xs uppercase tracking-widest text-[#ffb81c] transition-opacity duration-500 hover:bg-[#1a212c] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffb81c] ${showControls ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <RotateCw className="h-4 w-4" />Rotate · {rotation}°
      </button>
    </div>
  );
}
