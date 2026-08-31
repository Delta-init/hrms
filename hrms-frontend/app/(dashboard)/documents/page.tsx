"use client";
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FolderOpen, FileText, AlertTriangle, Loader2, BellOff, BellRing, Users, Building2 } from "lucide-react";
import { useDocumentsOverview, useIgnoreDocuments, useUnignoreDocuments } from "@/hooks/useDocumentsOverview";
import { useDepartments } from "@/hooks/useDepartments";
import { useAuth } from "@/hooks/useAuth";
import { useTableQuery } from "@/hooks/useTableQuery";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { CompanyDocumentsPanel } from "@/components/documents/CompanyDocumentsPanel";
import { useCompanyDocuments } from "@/hooks/useCompanyDocuments";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getInitials, cn } from "@/lib/utils";
import { LOCATION_LABELS, type DocumentRef, type DocumentRow, type DocumentStatus } from "@/types";

const ALL = "__all__";

/**
 * Every document the organization should hold — including the ones nobody has
 * filed. A missing document has no record anywhere, so the only way to find the
 * gaps used to be opening every employee in turn; the rows here are generated
 * from the requirement matrix instead, so absence is a row like any other.
 */

const STATUSES: Array<{ key: DocumentStatus; label: string; tone: string; dot: string; headline: boolean }> = [
  { key: "expired", label: "Expired", tone: "bg-red-500/10 text-red-600 border-red-500/20", dot: "bg-red-500", headline: true },
  { key: "expiring", label: "Expiring", tone: "bg-amber-500/10 text-amber-600 border-amber-500/20", dot: "bg-amber-500", headline: true },
  { key: "missing", label: "Missing", tone: "bg-orange-500/10 text-orange-600 border-orange-500/20", dot: "bg-orange-400", headline: true },
  { key: "not_uploaded", label: "Not uploaded", tone: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/40", headline: true },
  { key: "valid", label: "On file", tone: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", dot: "bg-emerald-500", headline: true },
  // Not a headline figure: the point of ignoring something is that it stops
  // being one of the numbers you look at. It stays filterable so a decision can
  // be found and undone.
  { key: "ignored", label: "Ignored", tone: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/40", headline: false },
];
const byStatus = new Map(STATUSES.map((s) => [s.key, s]));

/**
 * Horizons people actually chase documents on.
 *
 * Two months is the default. Ninety days turned things amber a full quarter
 * before anybody could act, so the bucket was permanently full and stopped
 * being read; at sixty days appearing in it is a reason to start the renewal.
 */
const DEFAULT_WINDOW = "60";
const WINDOWS = [
  { value: "30", label: "Next 30 days" },
  { value: "60", label: "Next 2 months" },
  { value: "90", label: "Next 3 months" },
  { value: "180", label: "Next 6 months" },
  { value: "365", label: "Next year" },
];

const fmtDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso)) : "—";

/** "in 42 days" / "3 days ago" / "today" — the number people actually act on. */
function whenDue(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "today";
  return days > 0 ? `in ${days} day${days === 1 ? "" : "s"}` : `${-days} day${days === -1 ? "" : "s"} ago`;
}

const Spinner = () => <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

/**
 * Suspense boundary for useSearchParams — without one Next refuses to
 * prerender the route at build time. Same shape as the employee detail page.
 */
export default function DocumentsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Documents />
    </Suspense>
  );
}

function Documents() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("employees", "view");
  const params = useSearchParams();

  // Deep-linked from the dashboard's "Docs expiring" card, which used to land on
  // a page with no way to filter by any of what it had counted.
  // The dashboard deep-links here with a status, so the tab is a query too —
  // a link that lands on the wrong half of the page is worse than no link.
  const [tab, setTab] = useState<string>(params.get("tab") === "company" ? "company" : "people");
  const [status, setStatus] = useState<string>(params.get("status") ?? ALL);
  const [within, setWithin] = useState<string>(params.get("within") ?? DEFAULT_WINDOW);
  const [location, setLocation] = useState<string>(ALL);
  const [department, setDepartment] = useState<string>(ALL);

  const query = useTableQuery({ defaultLimit: 100 });
  const { data: departmentData } = useDepartments();
  const departments = departmentData?.data ?? [];

  const apiParams = useMemo(() => {
    const p: Record<string, string> = { within };
    if (status !== ALL) p.status = status;
    if (location !== ALL) p.location = location;
    if (department !== ALL) p.department = department;
    if (query.debouncedSearch) p.search = query.debouncedSearch;
    return p;
  }, [status, within, location, department, query.debouncedSearch]);

  const { data, isLoading, isFetching } = useDocumentsOverview(apiParams);
  const rows = data?.rows ?? [];

  /**
   * How many company documents need attention, for the tab badge.
   *
   * The dashboard's "Docs expiring" figure counts both halves of this page, so
   * landing on the employee tab and seeing a smaller number would look like
   * something had gone missing. The badge says where the rest are.
   */
  const { data: companyData } = useCompanyDocuments({ within }, canView);
  const companyDue = (companyData?.counts.expired ?? 0) + (companyData?.counts.expiring ?? 0);

  const canEdit = hasPermission("employees", "edit");
  const { mutate: ignore, isPending: ignoring } = useIgnoreDocuments();
  const { mutate: unignore, isPending: restoring } = useUnignoreDocuments();

  // Keyed the same way the table keys its rows, so a key can be turned back
  // into the (employee, slot) pair the server needs without holding the rows.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");

  const refsOf = (keys: string[]): DocumentRef[] =>
    keys.map((k) => {
      const at = k.indexOf(":");
      return { employee: k.slice(0, at), slot: k.slice(at + 1) };
    });

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(`${r.employee._id}:${r.slot}`)),
    [rows, selected]
  );
  const anyIgnored = selectedRows.some((r) => r.status === "ignored");
  const anyLive = selectedRows.some((r) => r.status !== "ignored");

  const clearAll = () => { setSelected(new Set()); setReason(""); };

  const applyIgnore = () => {
    ignore(
      { items: refsOf(Array.from(selected)), reason },
      { onSuccess: () => { setReasonOpen(false); clearAll(); } }
    );
  };
  const applyRestore = () => {
    unignore({ items: refsOf(Array.from(selected)) }, { onSuccess: clearAll });
  };

  const columns: DataTableColumn<DocumentRow>[] = [
    {
      id: "employee", label: "Employee", alwaysVisible: true,
      render: (r) => (
        <Link href={`/employees/${r.employee._id}`} className="flex items-center gap-3 hover:underline">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {getInitials(r.employee.name)}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">{r.employee.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {r.employee.employeeCode}{r.employee.department ? ` · ${r.employee.department}` : ""}
            </div>
          </div>
        </Link>
      ),
    },
    {
      id: "document", label: "Document", alwaysVisible: true,
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{r.label}</div>
          {r.required && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">required</span>}
        </div>
      ),
    },
    { id: "location", label: "Location", defaultVisible: false, render: (r) => <span className="text-muted-foreground">{r.employee.location ? LOCATION_LABELS[r.employee.location] : "—"}</span> },
    { id: "number", label: "Number", render: (r) => <span className="tabular-nums text-muted-foreground">{r.number || "—"}</span> },
    { id: "issued", label: "Issued", defaultVisible: false, render: (r) => <span className="text-muted-foreground">{fmtDate(r.issueDate)}</span> },
    {
      id: "expiry", label: "Expires",
      render: (r) => (
        <div>
          <div className={cn("tabular-nums", r.status === "expired" && "font-medium text-red-600", r.status === "expiring" && "font-medium text-amber-600")}>
            {fmtDate(r.expiryDate)}
          </div>
          {r.daysToExpiry !== null && <div className="text-[11px] text-muted-foreground">{whenDue(r.daysToExpiry)}</div>}
        </div>
      ),
    },
    {
      id: "status", label: "Status", alwaysVisible: true,
      render: (r) => {
        const s = byStatus.get(r.status);
        const under = r.status === "ignored" ? byStatus.get(r.underlyingStatus) : null;
        return (
          <div className="flex flex-col items-start gap-0.5">
            <span
              className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", s?.tone)}
              title={r.ignored?.reason || undefined}
            >
              {r.status === "ignored" && <BellOff className="h-3 w-3" />}
              {s?.label ?? r.status}
            </span>
            {/* Say what is being suppressed, or the row reads as merely dull. */}
            {under && <span className="text-[10px] text-muted-foreground">was {under.label.toLowerCase()}</span>}
          </div>
        );
      },
    },
    {
      id: "file", label: "File", alwaysVisible: true,
      render: (r) =>
        r.file ? (
          <a href={r.file.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            <FileText className="h-3.5 w-3.5" />
            <span className="max-w-[140px] truncate">{r.file.fileName}</span>
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    { id: "uploaded", label: "Uploaded", defaultVisible: false, render: (r) => <span className="text-muted-foreground">{fmtDate(r.file?.uploadedAt ?? null)}</span> },
  ];

  if (!canView) {
    return (
      <div className="space-y-6">
        <PageHeader title="Documents" description="Passports, visas and certificates across the organization." icon={FolderOpen} />
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          You do not have permission to view other people&apos;s documents. Your own are on your profile.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        description="Every document the organization should hold — including the ones nobody has filed yet."
        icon={FolderOpen}
      />

      <Tabs
        tabs={[
          { key: "people", label: "Employee documents", icon: Users },
          { key: "company", label: "Company documents", icon: Building2, count: companyDue },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "company" ? (
        <CompanyDocumentsPanel
          within={within}
          onWithinChange={setWithin}
          windows={WINDOWS}
          initialStatus={params.get("status") ?? undefined}
          canEdit={canEdit}
          canDelete={hasPermission("employees", "delete")}
        />
      ) : (
      <>
      {/* The figures first, and each one filters the table. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {STATUSES.filter((s) => s.headline).map((s) => {
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

      {/* Absence is the normal state here, so say so rather than letting a wall
          of "Missing" read as something being broken. */}
      {!!data && (data.counts.missing ?? 0) > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-orange-500/30 bg-orange-500/5 px-4 py-3 text-sm text-orange-700 dark:text-orange-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>{data.counts.missing}</strong> required document{data.counts.missing === 1 ? " is" : "s are"} not on file
            across {data.employees} employee{data.employees === 1 ? "" : "s"}. Open an employee to upload, or use the
            Documents tab on their record.
          </span>
        </div>
      )}

      <DataTable
        tableId="documents_overview"
        columns={columns}
        rows={rows}
        rowKey={(r) => `${r.employee._id}:${r.slot}`}
        loading={isLoading || isFetching}
        query={query}
        // The overview returns every matching row in one response rather than a
        // page, so the footer has to be told what it is looking at — without
        // this it reads the absent pagination as zero and says "No documents"
        // under a full table.
        pagination={{ total: rows.length, page: 1, limit: rows.length || 1, totalPages: 1, hasNextPage: false, hasPrevPage: false }}
        selectable={canEdit}
        selected={selected}
        onSelectedChange={setSelected}
        bulkActions={() => (
          <>
            {anyLive && (
              <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={ignoring} onClick={() => setReasonOpen(true)}>
                <BellOff className="h-3.5 w-3.5" />Ignore
              </Button>
            )}
            {anyIgnored && (
              <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={restoring} onClick={applyRestore}>
                {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />}
                Stop ignoring
              </Button>
            )}
          </>
        )}
        searchable
        searchPlaceholder="Search employee, document or number…"
        emptyText="Nothing matches these filters."
        rowLabel="documents"
        minWidth={1000}
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
            <Select value={within} onValueChange={setWithin}>
              <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WINDOWS.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        }
        filters={
          <>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Location</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All locations</SelectItem>
                  {(Object.keys(LOCATION_LABELS) as Array<keyof typeof LOCATION_LABELS>).map((l) => (
                    <SelectItem key={l} value={l}>{LOCATION_LABELS[l]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Department</Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All departments</SelectItem>
                  {departments.map((d) => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </>
        }
        exportMapper={(r) => ({
          Employee: r.employee.name,
          Code: r.employee.employeeCode ?? "",
          Department: r.employee.department ?? "",
          Location: r.employee.location ? LOCATION_LABELS[r.employee.location] : "",
          Document: r.label,
          Required: r.required ? "Yes" : "No",
          Number: r.number,
          Issued: fmtDate(r.issueDate),
          Expires: fmtDate(r.expiryDate),
          Status: byStatus.get(r.status)?.label ?? r.status,
          Ignored: r.ignored ? "Yes" : "",
          "Ignored because": r.ignored?.reason ?? "",
          File: r.file?.fileName ?? "",
        })}
        exportName="documents"
      />
      </>
      )}

      <ResponsiveDialog open={reasonOpen} onOpenChange={(o) => { setReasonOpen(o); if (!o) setReason(""); }}>
        <ResponsiveDialogContent desktopClassName="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Stop counting {selected.size} document{selected.size === 1 ? "" : "s"}?</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-3 px-4 sm:px-0">
            <p className="text-sm text-muted-foreground">
              They stay on this list under <strong>Ignored</strong> and can be put back at any time — they just stop
              being counted as expired or expiring, here and on the dashboard.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="reason">Why (optional)</Label>
              <Input
                id="reason" value={reason} maxLength={200} autoFocus
                placeholder="e.g. renewed under a new number"
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => setReasonOpen(false)}>Cancel</Button>
            <Button type="button" onClick={applyIgnore} disabled={ignoring}>
              {ignoring && <Loader2 className="h-4 w-4 animate-spin" />}Ignore
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
