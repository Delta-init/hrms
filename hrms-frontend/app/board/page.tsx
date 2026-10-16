"use client";
import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5055/api/v1";
const REFRESH_MS = 30_000;
const SOON_MS = 15 * 60_000;

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
 */
export default function MeetingBoardPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [offline, setOffline] = useState(false);
  const [updated, setUpdated] = useState<number | null>(null);
  // Null until mounted: the server's time is not the screen's, and rendering it
  // there would only be replaced, with a mismatch, a moment later.
  const [mounted, setMounted] = useState<number | null>(null);
  const now = mounted ?? 0;

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

  return (
    <main className="flex min-h-screen flex-col gap-[clamp(1rem,2.5vmin,2rem)] bg-[#07090d] px-[clamp(1rem,3vmin,3rem)] py-[clamp(1rem,3vmin,2.5rem)] font-mono text-[#ece6d6]">
      {/* ── Header: where, and the time — the clock leads on a portrait screen ── */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-[#ffb81c] pb-[clamp(0.75rem,2vmin,1.5rem)] portrait:flex-col-reverse portrait:items-start">
        <div>
          <p className="text-[clamp(0.65rem,1.4vmin,0.9rem)] uppercase tracking-[0.35em] text-[#ffb81c]">Meeting rooms · Today</p>
          <h1 className="mt-1 text-[clamp(1.4rem,4.2vmin,3.5rem)] font-bold uppercase leading-tight tracking-wider">{board?.organization ?? "Meeting rooms"}</h1>
        </div>
        <div className="landscape:text-right">
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
          <section className="flex-1">
            <p className="mb-2 text-[clamp(0.65rem,1.4vmin,0.9rem)] uppercase tracking-[0.35em] text-[#ffb81c]">Bookings</p>
            {upcoming.length === 0 ? (
              <p className="py-16 text-center text-[clamp(1rem,2.4vmin,1.6rem)] uppercase tracking-[0.3em] text-[#8a93a3]">No meetings booked for the rest of today</p>
            ) : (
              <>
                {/* Portrait screens and phones: a card per booking. */}
                <ul className="grid gap-[clamp(0.4rem,1vmin,0.8rem)] landscape:sm:hidden">
                  {upcoming.map((b) => {
                    const s = statusOf(b, now);
                    const faded = s.tone === "ended" || s.tone === "cancelled";
                    return (
                      <li key={b.id} className={`rounded-lg border-l-4 bg-[#10151d] px-[clamp(0.75rem,2vmin,1.5rem)] py-[clamp(0.6rem,1.6vmin,1.2rem)] uppercase ${faded ? "opacity-55" : ""} ${
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
                <div className="hidden overflow-x-auto landscape:sm:block">
                  <table className="w-full border-separate border-spacing-y-[clamp(0.3rem,0.8vmin,0.6rem)] text-left">
                    <thead>
                      <tr className="text-[clamp(0.6rem,1.3vmin,0.9rem)] uppercase tracking-[0.25em] text-[#8a93a3]">
                        <th className="px-3 py-1 font-normal">Time</th>
                        <th className="px-3 py-1 font-normal">Meeting</th>
                        <th className="hidden px-3 py-1 font-normal md:table-cell">Booked by</th>
                        <th className="px-3 py-1 font-normal">Room</th>
                        <th className="px-3 py-1 text-right font-normal">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {upcoming.map((b) => {
                        const s = statusOf(b, now);
                        const faded = s.tone === "ended" || s.tone === "cancelled";
                        return (
                          <tr key={b.id} className={`bg-[#10151d] text-[clamp(0.85rem,2vmin,1.6rem)] uppercase ${faded ? "opacity-55" : ""}`}>
                            <td className={`whitespace-nowrap rounded-l-md border-l-4 px-3 py-[clamp(0.6rem,1.5vmin,1.1rem)] font-bold tabular-nums text-[#ffb81c] ${
                              s.tone === "live" ? "border-[#3ee089]" : s.tone === "soon" ? "border-[#ffb81c]" : s.tone === "cancelled" ? "border-[#ff5d50]" : "border-transparent"}`}>
                              {hm(b.start)}<span className="text-[#8a93a3]">–{hm(b.end)}</span>
                            </td>
                            <td className={`max-w-[32ch] truncate px-3 tracking-wide ${s.tone === "cancelled" ? "line-through" : ""}`}>{b.title}</td>
                            <td className="hidden max-w-[22ch] truncate px-3 text-[#b9b4a6] md:table-cell">{b.organiser || "—"}</td>
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
          </section>
        </>
      )}

      <footer className="flex flex-wrap justify-between gap-2 text-[clamp(0.6rem,1.2vmin,0.85rem)] uppercase tracking-[0.2em] text-[#5c6675]">
        <span>{offline && board ? <span className="text-[#ff5d50]">Connection lost — showing the last update</span> : "Refreshes every 30 seconds"}</span>
        {updated && <span>Updated {hm(updated)}</span>}
      </footer>
    </main>
  );
}
