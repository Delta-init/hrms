"use client";
import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Upload, X } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useReportEligible, useFilePerformanceReport } from "@/hooks/useMonthlyPerformanceReports";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const curMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Filing a monthly report — for yourself, or for anyone on your own team, if
 * you head one. The eligible list already only ever contains those two
 * groups, so there is nothing further to gate here on screen.
 */
export function PerformanceReportDialog({ open, onOpenChange }: Props) {
  const { data: eligible = [] } = useReportEligible();
  const { mutate: file, isPending } = useFilePerformanceReport();

  const [employee, setEmployee] = useState("");
  const [month, setMonth] = useState(curMonth());
  const [reportText, setReportText] = useState("");
  const [reportFile, setReportFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setMonth(curMonth());
    setReportText("");
    setReportFile(null);
    setEmployee((cur) => cur || eligible.find((e) => e.isSelf)?._id || eligible[0]?._id || "");
  }, [open, eligible]);

  const canSubmit = !!employee && !!month && (!!reportText.trim() || !!reportFile);

  const onSubmit = () => {
    file(
      { employee, month, reportText: reportText.trim() || undefined, file: reportFile },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader><ResponsiveDialogTitle>File a monthly report</ResponsiveDialogTitle></ResponsiveDialogHeader>
        <div className="space-y-4 px-4 sm:px-0">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>For *</Label>
              <Select value={employee} onValueChange={setEmployee}>
                <SelectTrigger><SelectValue placeholder="Who is this for?" /></SelectTrigger>
                <SelectContent>
                  {eligible.map((e) => (
                    <SelectItem key={e._id} value={e._id}>{e.isSelf ? "Myself" : e.name}{e.employeeCode ? ` · ${e.employeeCode}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prmonth">Month *</Label>
              <Input id="prmonth" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prtext">Report</Label>
            <Textarea id="prtext" rows={5} value={reportText} onChange={(e) => setReportText(e.target.value)}
              placeholder="What happened this month…" />
          </div>

          <div className="space-y-1.5">
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept=".pdf,image/*"
              onChange={(e) => { setReportFile(e.target.files?.[0] ?? null); e.target.value = ""; }}
            />
            {reportFile ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{reportFile.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{Math.ceil(reportFile.size / 1024)} KB</span>
                <button type="button" onClick={() => setReportFile(null)} aria-label="Remove the file"
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="w-full justify-start font-normal text-muted-foreground"
                onClick={() => fileInput.current?.click()}>
                <Upload className="h-4 w-4" />Attach a document
              </Button>
            )}
            <p className="text-[11px] text-muted-foreground">Write something, attach a document, or both. PDF or an image, up to 10 MB.</p>
          </div>
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canSubmit || isPending} onClick={onSubmit}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}File report
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
