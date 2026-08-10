"use client";
import { useState } from "react";
import Link from "next/link";
import { Users, Plus, FileText, MoreHorizontal, Trash2, ArrowLeft } from "lucide-react";
import { useCandidates, useDeleteCandidate } from "@/hooks/useCandidates";
import { useAuth } from "@/hooks/useAuth";
import { useTableQuery } from "@/hooks/useTableQuery";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { CandidateDialog } from "@/components/hiring/CandidateDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials } from "@/lib/utils";
import type { Candidate } from "@/types";

const fmtDate = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—";

/**
 * The people, kept apart from the vacancies they applied to.
 *
 * Somebody turned down in March and applying again in September is the same
 * person, and the second conversation is better for knowing about the first.
 */
export default function CandidatesPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("hiring", "create");
  const canDelete = hasPermission("hiring", "delete");

  const query = useTableQuery({ defaultLimit: 20 });
  const { data, isLoading, isFetching } = useCandidates(query.params);
  const { mutate: remove, isPending: deleting } = useDeleteCandidate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Candidate | null>(null);

  const columns: DataTableColumn<Candidate>[] = [
    {
      id: "candidate", label: "Candidate", alwaysVisible: true,
      render: (c) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {getInitials(c.name)}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">{c.name}</div>
            <div className="truncate text-xs text-muted-foreground">{c.email}</div>
          </div>
        </div>
      ),
    },
    {
      id: "current", label: "Currently",
      render: (c) => (
        <div className="min-w-0">
          <div className="truncate">{c.currentDesignation || "—"}</div>
          {c.currentCompany && <div className="truncate text-xs text-muted-foreground">{c.currentCompany}</div>}
        </div>
      ),
    },
    { id: "experience", label: "Experience", render: (c) => <span className="tabular-nums">{c.totalExperienceYears != null ? `${c.totalExperienceYears} yrs` : "—"}</span> },
    { id: "notice", label: "Notice", defaultVisible: false, render: (c) => <span className="tabular-nums">{c.noticePeriodDays != null ? `${c.noticePeriodDays} days` : "—"}</span> },
    { id: "expecting", label: "Expecting", render: (c) => <span className="tabular-nums">{c.expectedSalary ? `${c.currency ?? ""} ${c.expectedSalary}`.trim() : "—"}</span> },
    { id: "source", label: "Source", render: (c) => <span className="text-muted-foreground">{c.source || "—"}</span> },
    {
      id: "cv", label: "CV",
      render: (c) =>
        c.resumeUrl ? (
          <a href={c.resumeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            <FileText className="h-3.5 w-3.5" />
            <span className="max-w-[120px] truncate">{c.resumeFileName || "Resume"}</span>
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    { id: "added", label: "Added", defaultVisible: false, render: (c) => <span className="text-muted-foreground">{fmtDate(c.createdAt)}</span> },
    {
      id: "actions", label: "", alwaysVisible: true, align: "right",
      render: (c) =>
        canDelete ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setDeleteTarget(c)} className="cursor-pointer text-destructive focus:text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <Link href="/hiring" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />Hiring
      </Link>

      <PageHeader
        title="Candidates"
        description="Everyone who has been put forward, and what happened to them."
        icon={Users}
        action={canCreate && <Button onClick={() => setDialogOpen(true)} className="shadow-sm"><Plus className="h-4 w-4" />Add candidate</Button>}
      />

      <DataTable
        tableId="hiring_candidates"
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(c) => c._id}
        loading={isLoading || isFetching}
        pagination={data?.pagination}
        query={query}
        searchable
        searchPlaceholder="Search name, email or company…"
        emptyText="No candidates yet."
        rowLabel="candidates"
        minWidth={980}
        exportMapper={(c) => ({
          Name: c.name, Email: c.email, Phone: c.phone ?? "",
          "Current title": c.currentDesignation ?? "", "Current company": c.currentCompany ?? "",
          Experience: c.totalExperienceYears ?? "", "Notice days": c.noticePeriodDays ?? "",
          Expecting: c.expectedSalary ?? "", Currency: c.currency ?? "",
          Source: c.source ?? "", Added: fmtDate(c.createdAt),
        })}
        exportName="candidates"
      />

      <CandidateDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete this candidate?"
        description={`${deleteTarget?.name} and their CV will be removed. Anyone still in a live pipeline cannot be deleted.`}
        confirmLabel="Delete"
        isPending={deleting}
        onConfirm={() => { if (deleteTarget) remove(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) }); }}
      />
    </div>
  );
}
