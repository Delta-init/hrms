"use client";
import { useState } from "react";
import { CheckCircle2, FileText, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useApproveVisa, useReturnVisa, useSetVisaNotRequired, useVisaOutstanding, useVisaSubmissions } from "@/hooks/useVisa";
import { cn } from "@/lib/utils";
import type { VisaGateReason, VisaSubmissionRow } from "@/types";

const fmtDay = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso)) : "—";
const fmtWhen = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

const REASON: Record<VisaGateReason, string> = {
  missing: "Nothing on file",
  missing_date: "No expiry date",
  missing_copy: "No visa copy",
  expired: "Expired",
  returned: "Sent back",
};

type View = "waiting" | "outstanding" | "history";

/**
 * What employees have sent in through the visa popup, for HR to check. Nothing
 * reaches anybody's record until it is approved here; sending one back puts
 * the popup in front of them again with the reason.
 */
export function VisaUpdatesPanel() {
  const [view, setView] = useState<View>("waiting");
  const outstanding = useVisaOutstanding();
  const waiting = useVisaSubmissions("pending", view === "waiting");
  const history = useVisaSubmissions(undefined, view === "history");
  const c = outstanding.data?.counts;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: "Dubai staff", value: c?.total, tone: "" },
          { label: "Up to date", value: c?.upToDate, tone: "text-emerald-600" },
          { label: "Waiting for you", value: c?.waiting, tone: "text-sky-600" },
          { label: "Still to update", value: c?.outstanding, tone: "text-amber-600" },
          { label: "Visa not needed", value: c?.exempt, tone: "text-muted-foreground" },
        ].map((x) => (
          <div key={x.label} className="rounded-2xl border bg-card p-4">
            <div className="text-xs font-medium text-muted-foreground">{x.label}</div>
            <div className={cn("mt-1 text-2xl font-bold tabular-nums", x.tone)}>{x.value ?? "—"}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {([["waiting", `Waiting for you${c?.waiting ? ` (${c.waiting})` : ""}`], ["outstanding", `Still to update${c?.outstanding ? ` (${c.outstanding})` : ""}`], ["history", "Decided"]] as const).map(([k, label]) => (
          <Button key={k} size="sm" variant={view === k ? "default" : "outline"} onClick={() => setView(k)}>{label}</Button>
        ))}
      </div>

      {view === "waiting" && (
        waiting.isLoading ? <Spinner /> : !waiting.data?.rows.length ? (
          <Empty text="Nothing waiting — every visa sent in has been checked." />
        ) : (
          <div className="space-y-3">{waiting.data.rows.map((r) => <PendingRow key={r._id} row={r} />)}</div>
        )
      )}

      {view === "outstanding" && (
        outstanding.isLoading ? <Spinner /> : !outstanding.data?.rows.length ? (
          <Empty text="Every Dubai-based employee has a current visa on file or one waiting for you." />
        ) : <OutstandingList rows={outstanding.data.rows} />
      )}

      {view === "history" && (
        history.isLoading ? <Spinner /> : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr><th className="px-4 py-2 text-left font-medium">Employee</th><th className="px-4 py-2 text-left font-medium">Sent</th><th className="px-4 py-2 text-left font-medium">What</th><th className="px-4 py-2 text-left font-medium">File</th><th className="px-4 py-2 text-left font-medium">Decision</th></tr>
              </thead>
              <tbody>
                {(history.data?.rows ?? []).filter((r) => r.status !== "pending").map((r) => (
                  <tr key={r._id} className="border-t align-top">
                    <td className="px-4 py-2"><div className="font-medium">{r.employee?.name ?? "—"}</div><div className="text-xs text-muted-foreground">{r.employee?.department}</div></td>
                    <td className="px-4 py-2 text-muted-foreground">{fmtWhen(r.submittedAt)}</td>
                    <td className="px-4 py-2">{r.kind === "visa" ? `Visa · expires ${fmtDay(r.expiryDate)}` : "Renewal in progress"}</td>
                    <td className="px-4 py-2"><a href={r.file.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{r.file.name}</a></td>
                    <td className="px-4 py-2">
                      {r.status === "approved"
                        ? <span className="text-emerald-600">Approved</span>
                        : <span className="text-destructive">Sent back{r.reviewNote ? `: ${r.reviewNote}` : ""}</span>}
                      <div className="text-xs text-muted-foreground">{r.reviewedBy ?? ""}{r.reviewedAt ? ` · ${fmtWhen(r.reviewedAt)}` : ""}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

function PendingRow({ row: r }: { row: VisaSubmissionRow }) {
  const approve = useApproveVisa();
  const sendBack = useReturnVisa();
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  const isImage = r.file.contentType.startsWith("image/");

  return (
    <div className="rounded-xl border p-4">
      <div className="flex flex-wrap items-start gap-4">
        <a href={r.file.url} target="_blank" rel="noopener noreferrer"
          className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40 hover:opacity-90" title="Open the file">
          {isImage
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={r.file.url} alt={`${r.employee?.name ?? "Employee"}'s visa`} className="h-full w-full object-cover" />
            : <FileText className="h-8 w-8 text-muted-foreground" />}
        </a>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{r.employee?.name ?? "—"}</span>
            {r.employee?.employeeCode && <span className="text-xs text-muted-foreground">{r.employee.employeeCode}</span>}
            <Badge variant="outline">{r.kind === "visa" ? "Visa" : "Renewal in progress"}</Badge>
          </div>
          <div className="text-xs text-muted-foreground">{r.employee?.department || "—"} · sent {fmtWhen(r.submittedAt)}</div>
          {r.kind === "visa" ? (
            <div className="text-sm">
              Expiry entered: <strong>{fmtDay(r.expiryDate)}</strong>
              <span className="text-muted-foreground"> · on file now: {fmtDay(r.employee?.currentExpiry ?? null)}</span>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Their visa has expired and the renewal is under way. Approving gives them 30 days to send the new visa.</div>
          )}
          <a href={r.file.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            <FileText className="h-3.5 w-3.5" />{r.file.name}
          </a>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={() => setReturning((v) => !v)} disabled={approve.isPending}>
            <Undo2 className="h-4 w-4" />Send back
          </Button>
          <Button size="sm" onClick={() => approve.mutate(r._id)} disabled={approve.isPending || sendBack.isPending}>
            {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Approve
          </Button>
        </div>
      </div>
      {returning && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
            placeholder="What needs fixing — they see this. “The date doesn't match the visa”, “The photo is blurred”…" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setReturning(false); setNote(""); }}>Cancel</Button>
            <Button size="sm" variant="destructive" disabled={note.trim().length < 3 || sendBack.isPending}
              onClick={() => sendBack.mutate({ id: r._id, note: note.trim() }, { onSuccess: () => { setReturning(false); setNote(""); } })}>
              {sendBack.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Send back to {r.employee?.name?.split(" ")[0] ?? "them"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function OutstandingList({ rows }: { rows: NonNullable<ReturnType<typeof useVisaOutstanding>["data"]>["rows"] }) {
  const setNotRequired = useSetVisaNotRequired();
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr><th className="px-4 py-2 text-left font-medium">Employee</th><th className="px-4 py-2 text-left font-medium">Why they&apos;re asked</th><th className="px-4 py-2 text-left font-medium">Expiry on file</th><th className="px-4 py-2 text-left font-medium">Copy on file</th><th className="px-4 py-2" /></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r._id} className="border-t">
              <td className="px-4 py-2"><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{[r.employeeCode, r.department].filter(Boolean).join(" · ")}</div></td>
              <td className="px-4 py-2"><span className={cn(r.reason === "expired" || r.reason === "returned" ? "text-destructive" : "text-amber-600")}>{r.reason ? REASON[r.reason] : "—"}</span></td>
              <td className="px-4 py-2 tabular-nums">{fmtDay(r.expiryDate)}</td>
              <td className="px-4 py-2">{r.hasCopy ? "Yes" : "No"}</td>
              <td className="px-4 py-2 text-right">
                <Button size="sm" variant="ghost" disabled={setNotRequired.isPending}
                  onClick={() => setNotRequired.mutate({ employeeId: r._id, notRequired: true })}>Visa not needed</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Spinner = () => <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
const Empty = ({ text }: { text: string }) => <p className="rounded-xl border p-8 text-center text-sm text-muted-foreground">{text}</p>;
