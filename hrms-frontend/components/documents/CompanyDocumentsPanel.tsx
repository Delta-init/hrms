"use client";
import { useMemo, useState } from "react";
import { Building2, Plus, Pencil, Trash2, FileText } from "lucide-react";
import {
  useCompanyDocuments, useDeleteCompanyDocument,
} from "@/hooks/useCompanyDocuments";
import { useTableQuery } from "@/hooks/useTableQuery";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { CompanyDocumentDialog } from "@/components/documents/CompanyDocumentDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { companyDocTypeLabel, type CompanyDocument, type DocumentStatus } from "@/types";

const ALL = "__all__";

/**
 * Company documents — what the business itself has to keep current.
 *
 * The same status vocabulary as the employee view, minus the ones that cannot
 * apply here: a company document is never "missing", because it exists only
 * once somebody has added it. There is nothing to be absent from.
 */
const STATUSES: Array<{ key: DocumentStatus; label: string; tone: string; dot: string }> = [
  { key: "expired", label: "Expired", tone: "bg-red-500/10 text-red-600 border-red-500/20", dot: "bg-red-500" },
  { key: "expiring", label: "Expiring", tone: "bg-amber-500/10 text-amber-600 border-amber-500/20", dot: "bg-amber-500" },
  { key: "valid", label: "In date", tone: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", dot: "bg-emerald-500" },
];
const byStatus = new Map(STATUSES.map((s) => [s.key, s]));

const fmtDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso)) : "—";

/** "in 42 days" / "3 days ago" / "today" — the number people act on. */
function whenDue(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "today";
  return days > 0 ? `in ${days} day${days === 1 ? "" : "s"}` : `${-days} day${days === -1 ? "" : "s"} ago`;
}

interface Props {
  /** Days ahead that counts as expiring — one value, shared with the employee
   *  view, so switching tabs cannot silently change what "expiring" means. */
  within: string;
  onWithinChange: (value: string) => void;
  windows: Array<{ value: string; label: string }>;
  /** Deep-linked from the dashboard, which knows which bucket it sent you for. */
  initialStatus?: string;
  canEdit: boolean;
  canDelete: boolean;
}

export function CompanyDocumentsPanel({ within, onWithinChange, windows, initialStatus, canEdit, canDelete }: Props) {
  const [status, setStatus] = useState(initialStatus ?? ALL);
  const [company, setCompany] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CompanyDocument | null>(null);
  const [deleting, setDeleting] = useState<CompanyDocument | null>(null);

  const query = useTableQuery({ defaultLimit: 100 });
  const params = useMemo(() => {
    const p: Record<string, string> = { within };
    if (status !== ALL) p.status = status;
    if (company !== ALL) p.company = company;
    if (type !== ALL) p.documentType = type;
    if (query.debouncedSearch) p.search = query.debouncedSearch;
    return p;
  }, [within, status, company, type, query.debouncedSearch]);

  const { data, isLoading, isFetching } = useCompanyDocuments(params);
  const rows = data?.rows ?? [];
  const { mutate: remove, isPending: removing } = useDeleteCompanyDocument();

  const openAdd = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (doc: CompanyDocument) => { setEditing(doc); setDialogOpen(true); };

  const columns: DataTableColumn<CompanyDocument>[] = [
    {
      id: "company", label: "Company", alwaysVisible: true,
      render: (d) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{d.companyName}</div>
          <div className="truncate text-xs text-muted-foreground">{companyDocTypeLabel(d.documentType)}</div>
        </div>
      ),
    },
    { id: "type", label: "Document", defaultVisible: false, render: (d) => companyDocTypeLabel(d.documentType) },
    { id: "number", label: "Number", render: (d) => <span className="tabular-nums text-muted-foreground">{d.number || "—"}</span> },
    { id: "issued", label: "Issued", defaultVisible: false, render: (d) => <span className="text-muted-foreground">{fmtDate(d.issueDate)}</span> },
    {
      id: "expiry", label: "Expires", alwaysVisible: true,
      render: (d) => (
        <div>
          <div className={cn("tabular-nums", d.status === "expired" && "font-medium text-red-600", d.status === "expiring" && "font-medium text-amber-600")}>
            {fmtDate(d.expiryDate)}
          </div>
          {d.daysToExpiry !== null && <div className="text-[11px] text-muted-foreground">{whenDue(d.daysToExpiry)}</div>}
        </div>
      ),
    },
    {
      id: "status", label: "Status", alwaysVisible: true,
      render: (d) => {
        const s = byStatus.get(d.status);
        // No expiry is a legitimate answer for a permanent document, and saying
        // "In date" about something with no date would be a claim we cannot make.
        if (d.expiryDate === null) return <span className="text-xs text-muted-foreground">No expiry</span>;
        return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", s?.tone)}>{s?.label ?? d.status}</span>;
      },
    },
    {
      id: "file", label: "File", alwaysVisible: true,
      render: (d) =>
        d.fileUrl ? (
          <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            <FileText className="h-3.5 w-3.5" />
            <span className="max-w-[140px] truncate">{d.fileName || "File"}</span>
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: "actions", label: "", alwaysVisible: true, align: "right",
      render: (d) => (
        <div className="flex items-center justify-end gap-1">
          {canEdit && (
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(d)} aria-label="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleting(d)} aria-label="Delete">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* The figures first, and each one filters the table — the same shape the
          employee view uses, so the two read as one page. */}
      <div className="grid grid-cols-3 gap-3">
        {STATUSES.map((s) => {
          const count = data?.counts[s.key] ?? 0;
          const active = status === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setStatus(active ? ALL : s.key)}
              className={cn(
                "rounded-2xl border bg-card p-4 text-left shadow-sm transition hover:shadow-md",
                active ? "border-primary ring-1 ring-primary" : "border-border"
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full", s.dot)} />
                <span className="text-xs font-medium text-muted-foreground">{s.label}</span>
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{isLoading ? "—" : count}</div>
            </button>
          );
        })}
      </div>

      <DataTable
        tableId="company_documents"
        columns={columns}
        rows={rows}
        rowKey={(d) => d._id}
        loading={isLoading || isFetching}
        query={query}
        // Every matching row comes back in one response rather than a page, so
        // the footer has to be told what it is looking at.
        pagination={{ total: rows.length, page: 1, limit: rows.length || 1, totalPages: 1, hasNextPage: false, hasPrevPage: false }}
        searchable
        searchPlaceholder="Search company, type or number…"
        emptyText={data?.total ? "Nothing matches these filters." : "No company documents yet. Add the first one."}
        rowLabel="documents"
        minWidth={900}
        actions={canEdit && <Button size="sm" className="h-9 gap-1.5" onClick={openAdd}><Plus className="h-4 w-4" />Add document</Button>}
        quickFilters={
          <>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}{data?.counts[s.key] ? ` (${data.counts[s.key]})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={within} onValueChange={onWithinChange}>
              <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {windows.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        }
        filters={
          <>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Company</Label>
              <Select value={company} onValueChange={setCompany}>
                <SelectTrigger className="h-9 w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All companies</SelectItem>
                  {(data?.companies ?? []).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Document type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="h-9 w-[190px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All types</SelectItem>
                  {(data?.types ?? []).map((t) => <SelectItem key={t} value={t}>{companyDocTypeLabel(t)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </>
        }
        exportMapper={(d) => ({
          Company: d.companyName,
          Document: companyDocTypeLabel(d.documentType),
          Number: d.number,
          Issued: fmtDate(d.issueDate),
          Expires: fmtDate(d.expiryDate),
          Status: d.expiryDate ? byStatus.get(d.status)?.label ?? d.status : "No expiry",
          File: d.fileName ?? "",
          Notes: d.notes ?? "",
        })}
        exportName="company-documents"
      />

      <CompanyDocumentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        doc={editing}
        companies={data?.companies ?? []}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove this document?"
        description={
          <>
            <strong>{companyDocTypeLabel(deleting?.documentType)}</strong> for {deleting?.companyName} will be
            deleted, along with the attached file. This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        isPending={removing}
        onConfirm={() => deleting && remove(deleting._id, { onSuccess: () => setDeleting(null) })}
      />
    </div>
  );
}

/** Exported so the page can label its tab without knowing the panel's shape. */
export { Building2 as CompanyDocumentsIcon };
