"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Loader2, MapPin, Video, AlertTriangle, CheckCircle2, Clock, Copy, Check, Globe, Smartphone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMeetingBooking, useJoinMeeting } from "@/hooks/useMeetings";

type Step = "asking" | "denied" | "unsupported" | "joining" | "redirecting" | "ready" | "error";

/** The link opens this long before the start, and closes at the end — the server holds the same line. */
const OPENS_BEFORE_MS = 10 * 60_000;

const nameOf = (v: unknown) => (v && typeof v === "object" ? String((v as { name?: string }).name ?? "") : "");

/**
 * The door to an online review meeting.
 *
 * Every invite, reminder and Join button points here rather than at the
 * meeting itself. The page asks the browser where the person is, the server
 * records it against where they clocked in today, and only then hands back the
 * meeting link and sends them on. Without a location there is no link: the
 * page explains how to allow it and lets them try again.
 *
 * It opens ten minutes before the start and closes at the end. Opened early,
 * the page waits and asks for location the moment it opens.
 *
 * A computer goes straight into the meeting. A phone gets a choice instead:
 * sent to a Google Meet link, Android hands it to the Meet app — or, with no
 * app, to the Play Store — and an email opened in Gmail's or WhatsApp's own
 * browser does the same. So a phone is offered the app, real Chrome (out of
 * the built-in browser), or the link to copy, with a line on joining in the
 * browser without the app (Chrome's "Desktop site").
 */
export default function MeetJoinPage() {
  const { id } = useParams<{ id: string }>();
  const { data: meeting, isLoading, error: loadError } = useMeetingBooking(id);
  const join = useJoinMeeting();
  const [step, setStep] = useState<Step>("asking");
  const [message, setMessage] = useState("");
  const started = useRef(false);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Ticks while waiting for the meeting to open, so it opens without a reload.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const opensAt = meeting ? new Date(meeting.start).getTime() - OPENS_BEFORE_MS : 0;
  const phase = !meeting ? "open" : now < opensAt ? "early" : now > new Date(meeting.end).getTime() ? "ended" : "open";

  const attempt = useCallback(() => {
    if (!id) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) { setStep("unsupported"); return; }
    setStep("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStep("joining");
        join.mutate(
          { id, latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy },
          {
            onSuccess: (r) => {
              if (isPhone()) {
                setLink(r.meetingLink);
                setStep("ready");
                return;
              }
              setStep("redirecting");
              window.location.href = r.meetingLink;
            },
            onError: (e) => {
              setMessage((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Could not open the meeting.");
              setStep("error");
            },
          }
        );
      },
      (err) => setStep(err.code === err.PERMISSION_DENIED ? "denied" : "unsupported"),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  }, [id, join]);

  // Ask as soon as the meeting is known to be one we can join.
  useEffect(() => {
    if (started.current || !meeting) return;
    if (meeting.kind === "review" && meeting.mode === "online" && meeting.status === "booked" && !meeting.restricted && phase === "open") {
      started.current = true;
      attempt();
    }
  }, [meeting, attempt, phase]);

  const title = meeting?.restricted ? "Review meeting" : meeting?.title;
  const when = meeting
    ? `${new Date(meeting.start).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} – ${new Date(meeting.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "";

  const body = (() => {
    if (isLoading) return <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />;
    if (loadError || !meeting) return <Notice tone="error" text="This meeting could not be found." />;
    if (meeting.restricted) return <Notice tone="error" text="You are not invited to this meeting." />;
    if (meeting.status === "cancelled") return <Notice tone="error" text="This meeting was cancelled." />;
    if (meeting.kind !== "review" || meeting.mode !== "online") return <Notice tone="error" text="This meeting isn't held online." />;
    if (phase === "early") {
      return <Notice icon={Clock} text={`The meeting opens at ${new Date(opensAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — keep this page open and it will continue by itself.`} />;
    }
    if (phase === "ended") return <Notice tone="error" text="This meeting has ended." />;
    switch (step) {
      case "asking":
        return <Notice icon={MapPin} text="Allow your location when the browser asks — it's checked against your clock-in before you join." spin />;
      case "joining":
        return <Notice icon={MapPin} text="Checking your location…" spin />;
      case "redirecting":
        return <Notice icon={CheckCircle2} tone="ok" text="Taking you to the meeting…" spin />;
      case "ready": {
        const android = /Android/i.test(navigator.userAgent);
        const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        const isMeet = /(^|\.)meet\.google\.com$/i.test(hostOf(link));
        // Android's way of saying "open this in Chrome, not in an app" — and
        // out of Gmail's or WhatsApp's built-in browser. Falls back to the link.
        const inChrome = `intent://${link.replace(/^https?:\/\//i, "")}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(link)};end`;
        const copy = async () => {
          try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the link is shown below to select */ }
        };
        return (
          <div className="space-y-3 text-left">
            <Notice icon={CheckCircle2} tone="ok" text="You're checked in. Open the meeting:" />
            <Button asChild className="w-full"><a href={link}><Smartphone className="h-4 w-4" />Open in the {isMeet ? "Meet" : "meeting"} app</a></Button>
            {android && (
              <Button asChild variant="outline" className="w-full"><a href={inChrome}><Globe className="h-4 w-4" />Open in Chrome</a></Button>
            )}
            <Button variant="outline" className="w-full" onClick={copy}>
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}{copied ? "Link copied" : "Copy link"}
            </Button>
            <p className="break-all rounded-md bg-muted/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">{link}</p>
            {isMeet && (
              <p className="rounded-md border border-border p-3 text-xs leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">No Meet app?</span>{" "}
                {android
                  ? <>Tap <strong>Open in Chrome</strong>, then in Chrome&rsquo;s menu <strong>⋮</strong> tick <strong>Desktop site</strong> — Meet then lets you join right in the browser.</>
                  : ios
                    ? <>Copy the link and open it in <strong>Safari</strong> — Meet lets you join from the browser there.</>
                    : <>Open the link in your browser and turn on its <strong>desktop site</strong> option to join without the app.</>}
              </p>
            )}
          </div>
        );
      }
      case "denied":
        return (
          <div className="space-y-3">
            <Notice tone="error" text="Location is needed to join this meeting." />
            <p className="text-xs text-muted-foreground">
              Allow location for this site — on a phone, in the browser&rsquo;s site settings; on a computer, the location icon in the address bar — then try again.
            </p>
            <Button onClick={attempt}><MapPin className="h-4 w-4" />Try again</Button>
          </div>
        );
      case "unsupported":
        return (
          <div className="space-y-3">
            <Notice tone="error" text="Your location couldn't be found. Turn on location services and try again." />
            <Button onClick={attempt}><MapPin className="h-4 w-4" />Try again</Button>
          </div>
        );
      case "error":
        return (
          <div className="space-y-3">
            <Notice tone="error" text={message} />
            <Button onClick={attempt}><MapPin className="h-4 w-4" />Try again</Button>
          </div>
        );
    }
  })();

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Video className="h-6 w-6" /></div>
        <h1 className="text-lg font-semibold">{title ?? "Joining meeting"}</h1>
        {meeting && <p className="mt-1 text-sm text-muted-foreground">{when}{nameOf(meeting.reviewee) ? ` · Reviewing ${nameOf(meeting.reviewee)}` : ""}</p>}
        <div className="mt-6">{body}</div>
        <Link href="/meetings" className="mt-6 inline-block text-xs text-muted-foreground hover:underline">Back to meetings</Link>
      </Card>
    </div>
  );
}

/** A phone or tablet browser — the ones Meet tries to hand to its app. */
function isPhone() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS reports itself as a Mac
}

const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return ""; } };

function Notice({ text, tone, icon: Icon, spin }: { text: string; tone?: "ok" | "error"; icon?: React.ElementType; spin?: boolean }) {
  const I = Icon ?? (tone === "error" ? AlertTriangle : MapPin);
  return (
    <p className={`flex items-center justify-center gap-2 text-sm ${tone === "error" ? "text-destructive" : tone === "ok" ? "text-emerald-600" : "text-muted-foreground"}`}>
      {spin ? <Loader2 className="h-4 w-4 animate-spin" /> : <I className="h-4 w-4" />}
      {text}
    </p>
  );
}
