"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Loader2, MapPin, Video, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMeetingBooking, useJoinMeeting } from "@/hooks/useMeetings";

type Step = "asking" | "denied" | "unsupported" | "joining" | "redirecting" | "error";

const nameOf = (v: unknown) => (v && typeof v === "object" ? String((v as { name?: string }).name ?? "") : "");

/**
 * The door to an online review meeting.
 *
 * Every invite, reminder and Join button points here rather than at the
 * meeting itself. The page asks the browser where the person is, the server
 * records it against where they clocked in today, and only then hands back the
 * meeting link and sends them on. Without a location there is no link: the
 * page explains how to allow it and lets them try again.
 */
export default function MeetJoinPage() {
  const { id } = useParams<{ id: string }>();
  const { data: meeting, isLoading, error: loadError } = useMeetingBooking(id);
  const join = useJoinMeeting();
  const [step, setStep] = useState<Step>("asking");
  const [message, setMessage] = useState("");
  const started = useRef(false);

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
    if (meeting.kind === "review" && meeting.mode === "online" && meeting.status === "booked" && !meeting.restricted) {
      started.current = true;
      attempt();
    }
  }, [meeting, attempt]);

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
    switch (step) {
      case "asking":
        return <Notice icon={MapPin} text="Allow your location when the browser asks — it's checked against your clock-in before you join." spin />;
      case "joining":
        return <Notice icon={MapPin} text="Checking your location…" spin />;
      case "redirecting":
        return <Notice icon={CheckCircle2} tone="ok" text="Taking you to the meeting…" spin />;
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

function Notice({ text, tone, icon: Icon, spin }: { text: string; tone?: "ok" | "error"; icon?: React.ElementType; spin?: boolean }) {
  const I = Icon ?? (tone === "error" ? AlertTriangle : MapPin);
  return (
    <p className={`flex items-center justify-center gap-2 text-sm ${tone === "error" ? "text-destructive" : tone === "ok" ? "text-emerald-600" : "text-muted-foreground"}`}>
      {spin ? <Loader2 className="h-4 w-4 animate-spin" /> : <I className="h-4 w-4" />}
      {text}
    </p>
  );
}
