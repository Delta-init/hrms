"use client";
import { useRef, useState } from "react";
import { Film, Loader2, Upload } from "lucide-react";
import { useTeamVideo, useUploadTeamVideo } from "@/hooks/useFirstDays";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * The team's video for its new joiners' second day, on the department's own
 * page. Only its head and HR get an answer from the server, so for everyone
 * else this draws nothing. Uploading another replaces it for joiners who have
 * not finished watching.
 */
export function TeamVideoCard({ departmentId }: { departmentId: string }) {
  const { data: video, isLoading, isError } = useTeamVideo(departmentId);
  const { mutate: upload, isPending } = useUploadTeamVideo();
  const input = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");

  if (isLoading || isError) return null;
  return (
    <Card className="mb-6 p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Film className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Team video for new joiners</h3>
        <span className="text-xs text-muted-foreground">Watched on their second day, start to finish.</span>
      </div>
      {video ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,320px)_1fr]">
          <video src={video.url} controls preload="metadata" className="w-full rounded-lg bg-black" />
          <div className="text-sm">
            <p className="font-medium">{video.title}</p>
            <p className="text-xs text-muted-foreground">
              {clock(video.durationSeconds)} · uploaded {new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(video.uploadedAt))}
              {video.uploadedBy ? ` by ${video.uploadedBy}` : ""}
            </p>
          </div>
        </div>
      ) : (
        <p className="mb-4 text-sm text-amber-700 dark:text-amber-400">
          No team video yet — your new joiners will wait at this step on their second day until there is one.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-8 max-w-xs" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input ref={input} type="file" accept="video/mp4" className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) upload({ departmentId, file, title: title.trim() || undefined }, { onSuccess: () => setTitle("") });
          }} />
        <Button size="sm" variant="outline" disabled={isPending} onClick={() => input.current?.click()}>
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {isPending ? "Uploading…" : video ? "Replace the video" : "Upload a video"}
        </Button>
        <span className="text-[11px] text-muted-foreground">MP4, up to 250 MB.</span>
      </div>
    </Card>
  );
}
