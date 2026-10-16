"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5055/api/v1";
const REFRESH_MS = 30_000;
const SOON_MS = 15 * 60_000;

interface BoardRow {
  id: string;
  title: string;
  organiser: string;
  room: string;
  location: string;
  start: string;
  end: string;
  cancelled: boolean;
}
interface Board {
  organization: string;
  timeZone: string;
  bookings: BoardRow[];
}

type Status = { label: string; tone: "sched" | "soon" | "live" | "ended" | "cancelled"; note: string };

function statusOf(b: BoardRow, now: number): Status {
  const start = new Date(b.start).getTime(), end = new Date(b.end).getTime();
  const mins = (ms: number) => Math.max(1, Math.round(ms / 60_000));
  if (b.cancelled) return { label: "Cancelled", tone: "cancelled", note: "" };
  if (now >= end) return { label: "Ended", tone: "ended", note: "" };
  if (now >= start) return { label: "In progress", tone: "live", note: `${mins(end - now)} min left` };
  if (start - now <= SOON_MS) return { label: "Starting soon", tone: "soon", note: `in ${mins(start - now)} min` };
  return { label: "Scheduled", tone: "sched", note: "" };
}

const TONE: Record<Status["tone"], string> = {
  sched: "text-[#e9e4d4]",
  soon: "text-[#ffb81c] motion-safe:animate-pulse",
  live: "text-[#3ee089]",
  ended: "text-[#5c6675]",
  cancelled: "text-[#ff5d50]",
};

/**
 * The public meeting board: today's room and pod bookings as a departures
 * list, for a screen in the lobby. No sign-in — the code in the link opens
 * this and nothing else. Refreshes every thirty seconds; the clock and the
 * statuses move every second in between.
 */
export default function MeetingBoardPage() {
  const { token } = useParams<{ token: string }>();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<"invalid" | "offline" | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/meetings/board/${encodeURIComponent(token)}`, { cache: "no-store" });
        if (!live) return;
        if (res.status === 404) { setError("invalid"); setBoard(null); return; }
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { data: Board };
        setBoard(body.data);
        setError(null);
        setUpdated(Date.now());
      } catch {
        // Keep showing the last board; say it is not current.
        if (live) setError((e) => (e === "invalid" ? e : "offline"));
      }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { live = false; clearInterval(t); };
  }, [token]);

  useEffect(() => {
    document.title = board ? `Meetings · ${board.organization}` : "Meeting board";
  }, [board]);

  const tz = board?.timeZone || undefined;
  const hm = (d: string | number) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(d));
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: tz }).format(now);
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(now);

  return (
    <main className="min-h-screen bg-[#07090d] px-4 py-5 font-mono text-[#e9e4d4] sm:px-8 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-[#ffb81c] pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-[#ffb81c]">Meetings · Today</p>
          <h1 className="mt-1 text-2xl font-bold uppercase tracking-wider sm:text-4xl">{board?.organization ?? "Meeting board"}</h1>
        </div>
        <div className="sm:text-right">
          <p className="text-3xl font-bold tabular-nums text-[#ffb81c] sm:text-5xl" suppressHydrationWarning>{clock}</p>
          <p className="text-xs uppercase tracking-[0.2em] text-[#8a93a3]" suppressHydrationWarning>{today}</p>
        </div>
      </header>

      {error === "invalid" ? (
        <p className="py-24 text-center text-lg uppercase tracking-widest text-[#ff5d50]">This board link is not valid, or has been reset.</p>
      ) : !board ? (
        <p className="py-24 text-center text-sm uppercase tracking-[0.3em] text-[#8a93a3] motion-safe:animate-pulse">Loading…</p>
      ) : board.bookings.length === 0 ? (
        <p className="py-24 text-center text-lg uppercase tracking-[0.3em] text-[#8a93a3]">No meetings booked for the rest of today</p>
      ) : (
        <>
        {/* A phone: one stacked row per meeting, so room and status are never off-screen. */}
        <ul className="mt-4 space-y-2 sm:hidden">
          {board.bookings.map((b) => {
            const s = statusOf(b, now);
            const faded = s.tone === "ended" || s.tone === "cancelled";
            return (
              <li key={b.id} className={`rounded-md bg-[#10151d] px-3 py-2.5 uppercase ${faded ? "opacity-60" : ""}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-bold tabular-nums text-[#ffb81c]">{hm(b.start)}<span className="text-[#8a93a3]">–{hm(b.end)}</span></span>
                  <span className={`text-right text-sm font-bold tracking-wider ${TONE[s.tone]}`}>
                    {s.label}{s.note && <span className="ml-1.5 text-[10px] font-normal tracking-widest text-[#8a93a3]">{s.note}</span>}
                  </span>
                </div>
                <p className={`mt-1 truncate tracking-wide ${s.tone === "cancelled" ? "line-through" : ""}`}>{b.title}</p>
                <p className="mt-0.5 truncate text-xs tracking-wider text-[#b9b4a6]"><span className="font-bold text-[#e9e4d4]">{b.room}</span>{b.organiser ? ` · ${b.organiser}` : ""}</p>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[640px] border-separate border-spacing-y-1.5 text-left">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.25em] text-[#8a93a3]">
                <th className="px-3 py-1 font-normal">Time</th>
                <th className="px-3 py-1 font-normal">Meeting</th>
                <th className="hidden px-3 py-1 font-normal md:table-cell">Booked by</th>
                <th className="px-3 py-1 font-normal">Room</th>
                <th className="px-3 py-1 text-right font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {board.bookings.map((b) => {
                const s = statusOf(b, now);
                const faded = s.tone === "ended" || s.tone === "cancelled";
                return (
                  <tr key={b.id} className={`bg-[#10151d] text-sm uppercase sm:text-lg ${faded ? "opacity-60" : ""}`}>
                    <td className="whitespace-nowrap rounded-l-md px-3 py-3 font-bold tabular-nums text-[#ffb81c]">
                      {hm(b.start)}<span className="text-[#8a93a3]">–{hm(b.end)}</span>
                    </td>
                    <td className={`max-w-[28ch] truncate px-3 py-3 tracking-wide ${s.tone === "cancelled" ? "line-through" : ""}`}>{b.title}</td>
                    <td className="hidden max-w-[20ch] truncate px-3 py-3 text-[#b9b4a6] md:table-cell">{b.organiser || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-bold tracking-wider">{b.room}</td>
                    <td className="whitespace-nowrap rounded-r-md px-3 py-3 text-right">
                      <span className={`font-bold tracking-wider ${TONE[s.tone]}`}>{s.label}</span>
                      {s.note && <span className="block text-[11px] tracking-widest text-[#8a93a3]">{s.note}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      <footer className="mt-6 flex flex-wrap justify-between gap-2 text-[11px] uppercase tracking-[0.2em] text-[#5c6675]">
        <span>
          {error === "offline" ? <span className="text-[#ff5d50]">Connection lost — showing the last update</span> : "Refreshes every 30 seconds"}
        </span>
        {updated && <span suppressHydrationWarning>Updated {new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: tz }).format(updated)}</span>}
      </footer>
    </main>
  );
}
