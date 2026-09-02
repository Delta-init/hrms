"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlarmClock, Fingerprint, Power, Sunrise, Sunset, Lock, CheckCircle2, Loader2, MonitorSmartphone, MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import { useTodayAttendance, useClockIn, useClockOut } from "@/hooks/useSelfAttendance";
import { deviceKey, deviceLabel, deviceFingerprint } from "@/lib/device";
import type { PunchClientContext } from "@/types";

type Tone = "neutral" | "green" | "amber" | "red" | "primary";
const TONES: Record<Tone, { glow: string; text: string; badge: string; stroke: string }> = {
  neutral: { glow: "bg-slate-400/30", text: "text-slate-500", badge: "bg-slate-500/10 text-slate-600 border-slate-500/20", stroke: "#94a3b8" },
  green: { glow: "bg-emerald-400/50", text: "text-emerald-600", badge: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", stroke: "#10b981" },
  amber: { glow: "bg-amber-400/50", text: "text-amber-600", badge: "bg-amber-500/10 text-amber-600 border-amber-500/20", stroke: "#f59e0b" },
  red: { glow: "bg-red-500/50", text: "text-red-600", badge: "bg-red-500/10 text-red-600 border-red-500/20", stroke: "#ef4444" },
  primary: { glow: "bg-primary/50", text: "text-primary", badge: "bg-primary/10 text-primary border-primary/20", stroke: "#4f46e5" },
};

function fmtTime(iso?: string | null, tz?: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz, hour12: true }).format(new Date(iso)).toLowerCase();
}
function fmtClock(d: Date, tz?: string) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: tz, hour12: true }).format(d);
}
/**
 * What this browser can say about where the punch is being made.
 *
 * Only asked of remote staff — the people whose whereabouts the punch is the
 * only record of. The permission prompt can be declined, and that is a normal
 * answer rather than a failure: the punch goes through either way, carrying
 * `denied` so the attendance record says why there is no fix instead of
 * leaving a silent gap that reads like a bug.
 *
 * Needs a secure context. Over plain http on a LAN address the browser
 * withholds geolocation entirely, which surfaces here as "unsupported".
 */
async function collectPunchContext(wantsLocation: boolean): Promise<PunchClientContext> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Sent on every punch, not only when binding is on. The server decides
  // whether it matters; the client asking first would just be a round trip,
  // and a browser that has never sent one has no device to be bound to.
  const key = deviceKey();
  const device: PunchClientContext = key
    ? { deviceKey: key, deviceLabel: deviceLabel(), deviceFingerprint: deviceFingerprint() }
    : {};

  if (!wantsLocation) return { timeZone, ...device };
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { timeZone, ...device, locationSource: "unsupported" };
  }

  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        // Long enough for a cold GPS fix indoors, short enough that nobody
        // stands watching a spinner wondering whether they clocked in.
        timeout: 12_000,
        maximumAge: 60_000,
      });
    });
    return {
      timeZone,
      ...device,
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      locationSource: "gps",
    };
  } catch (e) {
    const code = (e as GeolocationPositionError | undefined)?.code;
    return {
      timeZone,
      ...device,
      locationSource: code === 1 /* PERMISSION_DENIED */ ? "denied" : "unavailable",
    };
  }
}

const NOTICE_KEY = "hrms.remote-punch-notice";

/**
 * How long a day must run before it can be closed.
 *
 * A clock-out arriving seconds after the clock-in is somebody pressing twice —
 * a double tap, a slow page, a button that did not look like it worked. The day
 * it produces reads as zero minutes worked, and correcting that means an admin
 * editing the record by hand. Holding the button for ten minutes costs nothing
 * to anyone actually working and removes the whole class of mistake.
 */
const MIN_SHIFT_MS = 10 * 60_000;

function fmtDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function ClockCard() {
  const { data, isLoading } = useTodayAttendance();
  const { mutate: clockIn, isPending: clockingIn } = useClockIn();
  const { mutate: clockOut, isPending: clockingOut } = useClockOut();
  const [now, setNow] = useState(() => new Date());
  const [noticeFor, setNoticeFor] = useState<"in" | "out" | null>(null);
  const [locating, setLocating] = useState(false);
  /** Which punch just landed, so the card can say so plainly. */
  const [confirmed, setConfirmed] = useState<"in" | "out" | null>(null);
  /**
   * Whether the browser will even ask.
   *
   * A refusal is remembered for the site: getCurrentPosition then fails
   * instantly with PERMISSION_DENIED and no prompt appears, so somebody told to
   * "allow location and try again" is being asked to accept an invitation that
   * is never issued. The state is read up front so the card can say what
   * actually has to happen — which is in the browser's own settings, not here.
   */
  const [geoState, setGeoState] = useState<PermissionState | "unknown">("unknown");

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /** Set once the permission is allowed but this page is still running without it. */
  const [needsReload, setNeedsReload] = useState(false);

  useEffect(() => {
    // Not in every browser — Safari has no Permissions API for geolocation —
    // so "unknown" is a real answer and the card simply says less.
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    const onChange = () => {
      const next = status?.state ?? "unknown";
      setGeoState(next);
      // Changing a site permission in the browser's own settings does not
      // reach a page already open — Chrome hands it the old answer until it
      // reloads. Somebody who has just switched Location on and watched the
      // punch fail anyway is looking at a page that has not been told.
      if (next === "granted") setNeedsReload(true);
    };
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((s) => { status = s; setGeoState(s.state); s.addEventListener("change", onChange); })
      .catch(() => setGeoState("unknown"));
    return () => status?.removeEventListener("change", onChange);
  }, []);

  /**
   * Ask before the punch, not during it.
   *
   * Requesting a location only when somebody presses Clock In puts the
   * browser's prompt between them and the thing they came to do, and a prompt
   * dismissed in that moment is a refusal remembered forever. Asking on arrival
   * gets it out of the way while nothing is at stake — and only where it is
   * actually required, and only while the browser is still willing to ask.
   */
  const wantsLocation = !!data?.punchPolicy.locationRequired;
  useEffect(() => {
    if (!wantsLocation || geoState !== "prompt") return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      () => setGeoState("granted"),
      () => { /* Their answer either way; the card reads it from the permission. */ },
      { timeout: 12_000, maximumAge: 60_000 }
    );
  }, [wantsLocation, geoState]);

  if (isLoading || !data) {
    return <Card className="flex h-full min-h-[360px] items-center justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>;
  }

  const { attendance, schedule, shift, punchPolicy } = data;
  const tz = schedule.timeZone;

  // Only remote staff are asked for a location: they are the ones no kiosk
  // sees, and whose punch is the sole account of where the day started.
  const recordsLocation = punchPolicy.workMode === "wfh";
  // Required and refused: pressing the button can only fail, and the browser
  // will not re-ask. Say so where the button is.
  const locationBlocked = !!punchPolicy.locationRequired && geoState === "denied";

  const send = async (dir: "in" | "out") => {
    setLocating(recordsLocation);
    const ctx = await collectPunchContext(recordsLocation);
    setLocating(false);
    (dir === "in" ? clockIn : clockOut)(ctx, {
      // Shown on the answer, not on the press: a punch that was refused — no
      // location, wrong device, already clocked in — must not flash a
      // confirmation on its way to failing.
      onSuccess: () => setConfirmed(dir),
    });
  };

  const punch = (dir: "in" | "out") => {
    // Say what is about to be collected before the browser's own prompt
    // appears, not after. Once acknowledged it stays acknowledged; the standing
    // line beneath the clock keeps it from becoming a thing they agreed to once
    // and never saw again.
    if (recordsLocation && localStorage.getItem(NOTICE_KEY) !== "ack") {
      setNoticeFor(dir);
      return;
    }
    void send(dir);
  };

  const t = now.getTime();
  const windowOpen = new Date(shift.windowOpen).getTime();
  const lateAt = new Date(shift.lateThreshold).getTime();
  const halfAt = new Date(shift.halfDayThreshold).getTime();

  // Resolve current phase → tone, label, action.
  let tone: Tone = "primary";
  let title = "";
  let sub = "";
  let action: (() => void) | null = null;
  let actionLabel = "";
  let ActionIcon = AlarmClock;
  let pulse = false;
  // Waiting on the location fix counts as busy: the button must not look
  // pressable again while the browser is still deciding.
  const busy = clockingIn || clockingOut || locating;

  // Office staff punch at a kiosk once the organization enforces it, so the
  // button is not theirs to press — except to close a session they opened here
  // before it was switched on, which the server still allows.
  const kioskOnly = !punchPolicy.canSelfPunch;

  if (attendance?.checkOut) {
    tone = attendance.status === "half_day" ? "red" : attendance.status === "late" ? "amber" : "green";
    title = "Shift complete";
    sub = `Worked ${Math.floor(attendance.workedMinutes / 60)}h ${attendance.workedMinutes % 60}m`;
    actionLabel = "Done"; ActionIcon = CheckCircle2;
  } else if (attendance?.checkIn && kioskOnly && !punchPolicy.canFinishOpenSession) {
    tone = "neutral";
    title = "Clock out at the kiosk";
    sub = `Clocked in ${fmtTime(attendance.checkIn, tz)} · elapsed ${fmtDuration(t - new Date(attendance.checkIn).getTime())}`;
    actionLabel = "Kiosk only"; ActionIcon = MonitorSmartphone;
  } else if (attendance?.checkIn) {
    tone = attendance.status === "half_day" ? "red" : attendance.status === "late" ? "amber" : "green";
    title = "Clocked in";
    const heldFor = MIN_SHIFT_MS - (t - new Date(attendance.checkIn).getTime());
    if (heldFor > 0) {
      // Counted down rather than merely greyed out: a disabled button with no
      // explanation reads as broken, and somebody who has just clocked in is
      // exactly the person who will press it again.
      sub = `Elapsed ${fmtDuration(t - new Date(attendance.checkIn).getTime())} · you can clock out in ${fmtDuration(heldFor)}`;
      actionLabel = `Clock Out in ${fmtDuration(heldFor)}`;
      ActionIcon = Lock;
    } else {
      sub = `Elapsed ${fmtDuration(t - new Date(attendance.checkIn).getTime())}`;
      action = () => punch("out"); actionLabel = "Clock Out"; ActionIcon = Power; pulse = true;
    }
  } else if (kioskOnly) {
    tone = "neutral";
    title = "Check in at the kiosk";
    sub = "You're set up as office-based, so your attendance is recorded there.";
    actionLabel = "Kiosk only"; ActionIcon = MonitorSmartphone;
  } else if (t < windowOpen) {
    tone = "neutral";
    title = "Not open yet";
    sub = `Opens at ${fmtTime(shift.windowOpen, tz)}`;
    actionLabel = "Locked"; ActionIcon = Lock;
  } else {
    // ready to clock in
    if (t <= lateAt) { tone = "green"; sub = "You're on time"; }
    else if (t <= halfAt) { tone = "amber"; sub = "You're running late"; }
    else { tone = "red"; sub = "Late — counts as half day"; }
    title = "Ready to clock in";
    action = () => punch("in"); actionLabel = "Clock In"; ActionIcon = Fingerprint; pulse = true;
  }

  const c = TONES[tone];
  const statusLabel = attendance ? (attendance.status === "half_day" ? "Half Day" : attendance.status === "late" ? "Late" : attendance.status === "present" ? "Present" : attendance.status) : "Not clocked in";

  // Radial progress = fraction of the shift elapsed.
  const shiftStartMs = new Date(shift.shiftStart).getTime();
  const shiftEndMs = new Date(shift.shiftEnd).getTime();
  const progress = Math.max(0, Math.min(1, (t - shiftStartMs) / (shiftEndMs - shiftStartMs || 1)));
  const R = 45, CIRC = 2 * Math.PI * R;

  return (
    <Card className="flex h-full flex-col p-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold">Daily Attendance</h3>
          <p className="text-sm text-muted-foreground">{schedule.loginTime}–{schedule.logoutTime} · {tz}</p>
        </div>
        <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", c.badge)}>{statusLabel}</span>
      </div>

      {/* live current time */}
      <p className="mt-1 text-center font-mono text-2xl font-bold tabular-nums tracking-tight">{fmtClock(now, tz)}</p>

      {/* big animated clock button */}
      <div className="flex flex-1 items-center justify-center py-4">
        <button
          type="button"
          onClick={() => action?.()}
          disabled={!action || busy}
          className={cn("group relative flex h-40 w-40 items-center justify-center rounded-full transition-transform", action && !busy ? "cursor-pointer active:scale-95" : "cursor-default")}
        >
          {/* pulsing glow */}
          <motion.span aria-hidden className={cn("absolute -inset-3 rounded-full opacity-60 blur-xl", c.glow)}
            animate={pulse ? { scale: [1, 1.12, 1], opacity: [0.45, 0.7, 0.45] } : {}} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} />

          {/* radial progress ring */}
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
            <circle cx="50" cy="50" r={R} fill="none" stroke="currentColor" strokeWidth="6" className="text-muted/60" />
            <motion.circle
              cx="50" cy="50" r={R} fill="none" stroke={c.stroke} strokeWidth="6.5" strokeLinecap="round"
              strokeDasharray={CIRC}
              initial={false}
              animate={{ strokeDashoffset: CIRC * (1 - progress) }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </svg>

          {/* inner face */}
          <span className="absolute inset-[14px] flex flex-col items-center justify-center rounded-full bg-background shadow-inner">
            {busy ? (
              <Loader2 className={cn("h-10 w-10 animate-spin", c.text)} />
            ) : (
              <motion.span
                animate={pulse ? { scale: [1, 1.14, 1], y: [0, -1, 0] } : {}}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                className="transition-transform group-hover:scale-110"
              >
                <ActionIcon className={cn("h-10 w-10", c.text)} strokeWidth={2.2} />
              </motion.span>
            )}
            <span className={cn("mt-1.5 text-sm font-semibold", c.text)}>{actionLabel}</span>
          </span>
        </button>
      </div>

      <p className={cn("text-center text-sm font-medium", c.text)}>{title}</p>
      <p className="text-center text-xs text-muted-foreground">{sub}</p>

      {/* in / out chips */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border p-3 text-center">
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><Sunrise className="h-4 w-4 text-amber-500" />Clock-in</p>
          <p className="mt-1 text-base font-semibold tabular-nums">{fmtTime(attendance?.checkIn, tz)}</p>
        </div>
        <div className="rounded-xl border border-border p-3 text-center">
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><Sunset className="h-4 w-4 text-rose-500" />Clock-out</p>
          <p className="mt-1 text-base font-semibold tabular-nums">{fmtTime(attendance?.checkOut, tz)}</p>
        </div>
      </div>

      {/* Standing notice, not a one-off consent. Somebody whose location is
          recorded twice a day should be able to see that said plainly, on the
          screen where it happens, rather than recall a dialog from months ago. */}
      {/* Before the button, and specific about where the fix lives. "Allow
          location and try again" is useless advice once the browser has stopped
          asking — the setting is behind the padlock in the address bar, and
          nothing this page does can open it. */}
      {/* Allowed since the page opened. The browser told us, but it will keep
          answering this page with the old refusal until it reloads — so the
          only useful thing here is the reload itself. */}
      {needsReload && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] leading-snug text-emerald-800 dark:text-emerald-300">
          <span className="flex-1">Location is allowed now. Reload the page so your punch can use it.</span>
          <Button size="sm" className="h-7 shrink-0" onClick={() => window.location.reload()}>Reload</Button>
        </div>
      )}

      {locationBlocked && !needsReload && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-800 dark:text-amber-300">
          <p className="font-medium">Location is blocked for this site, so your punch will be refused.</p>
          <p className="mt-0.5">
            Your browser remembers that it was declined and will not ask again. Open the padlock
            (or <span className="font-mono">ⓘ</span>) beside the address, set <strong>Location</strong> to
            <strong> Allow</strong>, then reload this page. On iPhone also check Settings → Privacy → Location
            Services → Safari.
          </p>
          {/* For the case the browser has quietly changed its mind — a reset in
              site settings, or a different answer on another device — so it can
              be tried without hunting for the reload button. */}
          <Button
            size="sm" variant="outline"
            className="mt-2 h-7 border-amber-500/40 bg-transparent text-amber-800 hover:bg-amber-500/10 dark:text-amber-300"
            onClick={() => window.location.reload()}
          >
            I have allowed it — reload
          </Button>
        </div>
      )}

      {recordsLocation && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <MapPin className="mt-px h-3 w-3 shrink-0" />
          <span>
            {/* Said before the button, not after it is refused: somebody who
                has to allow a prompt should know that before they press. */}
            {punchPolicy.locationRequired
              ? "Working remotely — your location is required to punch, and your IP address and device are recorded with it. Allow location when your browser asks."
              : "Working remotely — your location, IP address and device are recorded with each punch."}
            {punchPolicy.device.policy !== "off" && (
              punchPolicy.device.registered
                ? ` Attendance is tied to ${punchPolicy.device.label || "your registered device"}.`
                : " This browser will be registered as your attendance device."
            )}
          </span>
        </p>
      )}

      <ResponsiveDialog open={noticeFor !== null} onOpenChange={(o) => !o && setNoticeFor(null)}>
        <ResponsiveDialogContent desktopClassName="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              Before you check {noticeFor === "out" ? "out" : "in"}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-3 px-4 text-sm text-muted-foreground sm:px-0">
            <p>
              You&apos;re set up as working remotely, so each check-in and check-out records where it
              was made from. Your employer keeps this as the record of your attendance.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Your approximate location, to about 100 metres — never your exact address</li>
              <li>Your IP address and the country it belongs to</li>
              <li>The browser and device you punched from</li>
              {punchPolicy.device.policy !== "off" && (
                <li>
                  This browser is registered as your attendance device
                  {punchPolicy.device.policy === "enforce"
                    ? " — punches from another one are refused until HR resets it"
                    : " — punches from another one are flagged for review"}
                </li>
              )}
            </ul>
            <p>
              Your browser will ask permission for the location. You can decline, and your punch
              still goes through — the record simply notes that no location was shared.
            </p>
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setNoticeFor(null)}>Cancel</Button>
            <Button
              onClick={() => {
                const dir = noticeFor;
                localStorage.setItem(NOTICE_KEY, "ack");
                setNoticeFor(null);
                if (dir) void send(dir);
              }}
            >
              Got it — check me {noticeFor === "out" ? "out" : "in"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Said back to them, on the answer.
          A toast slides away while somebody is still looking at the button they
          pressed, which is why the button gets pressed again. This waits to be
          dismissed, and states the time that was recorded — the one fact worth
          checking, and the one they will be asked about later. */}
      <ResponsiveDialog open={confirmed !== null} onOpenChange={(o) => !o && setConfirmed(null)}>
        <ResponsiveDialogContent desktopClassName="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              {confirmed === "in" ? "Clocked in" : "Clocked out"}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="px-1 text-sm text-muted-foreground">
            {confirmed === "in" ? (
              <>
                <p>
                  Recorded at <strong className="text-foreground">{fmtTime(attendance?.checkIn ?? new Date().toISOString(), tz)}</strong>.
                </p>
                <p className="mt-1.5">
                  Clocking out is held for ten minutes, so a second tap cannot close the day you
                  have just opened.
                </p>
              </>
            ) : (
              <>
                <p>
                  Recorded at <strong className="text-foreground">{fmtTime(attendance?.checkOut ?? new Date().toISOString(), tz)}</strong>.
                </p>
                {attendance?.workedMinutes ? (
                  <p className="mt-1.5">
                    Worked <strong className="text-foreground">
                      {Math.floor(attendance.workedMinutes / 60)}h {attendance.workedMinutes % 60}m
                    </strong> today.
                  </p>
                ) : null}
              </>
            )}
          </div>
          <ResponsiveDialogFooter>
            <Button className="w-full" onClick={() => setConfirmed(null)}>Done</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </Card>
  );
}
