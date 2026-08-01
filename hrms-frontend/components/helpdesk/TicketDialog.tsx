"use client";
import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAddTicketComment, useAssignTicket, useSetTicketStatus } from "@/hooks/useHelpdesk";
import { useUsers } from "@/hooks/useUsers";
import { cn, getInitials } from "@/lib/utils";
import {
  HELPDESK_CATEGORY_LABELS, HELPDESK_PRIORITY_LABELS, HELPDESK_STATUS_LABELS,
  type HelpdeskTicket, type HelpdeskStatus,
} from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: HelpdeskTicket | null;
  canManage?: boolean;
}

const statusStyles: Record<HelpdeskStatus, string> = {
  open: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  in_progress: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  resolved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  closed: "bg-muted text-muted-foreground border-border",
};
const priorityStyles: Record<string, string> = { low: "text-muted-foreground", medium: "text-amber-600", high: "text-red-600" };
const fmt = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const nameOf = (v: HelpdeskTicket["createdBy"]) => (v && typeof v === "object" ? v.name : null);

export function TicketDialog({ open, onOpenChange, ticket, canManage = false }: Props) {
  const [comment, setComment] = useState("");
  const { mutate: addComment, isPending: commenting } = useAddTicketComment();
  const { mutate: assign, isPending: assigning } = useAssignTicket();
  const { mutate: setStatus, isPending: settingStatus } = useSetTicketStatus();
  const { data: usersData } = useUsers(canManage ? { limit: "200" } : undefined);
  const staff = usersData?.data ?? [];

  if (!ticket) return null;

  const submitComment = () => {
    if (!comment.trim()) return;
    addComment({ id: ticket._id, body: comment.trim() }, { onSuccess: () => setComment("") });
  };
  const assigneeId = ticket.assignedTo && typeof ticket.assignedTo === "object" ? ticket.assignedTo._id : "";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex flex-wrap items-center gap-2">
            {ticket.subject}
            <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", statusStyles[ticket.status])}>{HELPDESK_STATUS_LABELS[ticket.status]}</span>
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-4 px-4 pb-2 sm:px-0">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="outline">{HELPDESK_CATEGORY_LABELS[ticket.category]}</Badge>
            <span className={cn("font-medium capitalize", priorityStyles[ticket.priority])}>{HELPDESK_PRIORITY_LABELS[ticket.priority]} priority</span>
            {nameOf(ticket.createdBy) && <span>Raised by {nameOf(ticket.createdBy)}</span>}
            <span>{fmt(ticket.createdAt)}</span>
          </div>

          <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">{ticket.description}</p>

          {canManage && (
            <div className="grid grid-cols-2 gap-3 rounded-md border border-border p-3">
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Assignee</span>
                <Select
                  value={assigneeId || "__unassigned__"}
                  onValueChange={(v) => assign({ id: ticket._id, assignedTo: v === "__unassigned__" ? null : v })}
                  disabled={assigning}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">Unassigned</SelectItem>
                    {staff.map((u) => <SelectItem key={u._id} value={u._id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Status</span>
                <Select value={ticket.status} onValueChange={(v) => setStatus({ id: ticket._id, status: v as HelpdeskStatus })} disabled={settingStatus}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(HELPDESK_STATUS_LABELS) as HelpdeskStatus[]).map((s) => <SelectItem key={s} value={s}>{HELPDESK_STATUS_LABELS[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {!canManage && nameOf(ticket.assignedTo) && (
            <p className="text-xs text-muted-foreground">Assigned to <span className="font-medium text-foreground">{nameOf(ticket.assignedTo)}</span></p>
          )}

          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">Comments</span>
            {ticket.comments.length === 0 ? (
              <p className="text-xs text-muted-foreground">No comments yet.</p>
            ) : (
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {ticket.comments.map((c, i) => {
                  const author = c.author && typeof c.author === "object" ? c.author.name : "Someone";
                  return (
                    <div key={i} className="flex items-start gap-2">
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">{getInitials(author)}</div>
                      <div className="min-w-0 flex-1 rounded-md bg-muted/50 px-2.5 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">{author}</span>
                          <span className="text-[10px] text-muted-foreground">{fmt(c.at)}</span>
                        </div>
                        <p className="whitespace-pre-wrap text-sm">{c.body}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex items-start gap-2">
              <Textarea rows={2} placeholder="Add a comment…" value={comment} onChange={(e) => setComment(e.target.value)} className="flex-1" />
              <Button size="icon" onClick={submitComment} disabled={commenting || !comment.trim()} className="shrink-0">
                {commenting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
