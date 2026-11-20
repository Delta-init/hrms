"use client";
import { Building2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { cn, getInitials } from "@/lib/utils";
import {
  assetCategoryLabel, ASSET_CONDITION_LABELS, ASSET_STATUS_LABELS, type Asset, type AssetStatus,
} from "@/types";

export const ASSET_STATUS_STYLES: Record<AssetStatus, string> = {
  available: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  assigned: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  maintenance: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  retired: "bg-muted text-muted-foreground border-border",
};
export const ASSET_CONDITION_STYLES: Record<string, string> = {
  new: "text-emerald-600", good: "text-emerald-600", fair: "text-amber-600",
  poor: "text-red-500", damaged: "text-red-600",
};

const fmtDate = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children || "—"}</dd>
    </div>
  );
}

/**
 * One asset, read-only: everything the register holds about it and what has happened to it (2026-11-20 —
 * "view option also add"). Open to anyone who can see the asset, whether or not they can change it; the
 * history that used to have its own dialog is the bottom half of this one.
 */
export function AssetViewDialog({ asset, onOpenChange }: { asset: Asset | null; onOpenChange: (open: boolean) => void }) {
  const person = asset?.assignedTo && typeof asset.assignedTo === "object" ? asset.assignedTo : null;
  const dept = asset?.assignedDepartment && typeof asset.assignedDepartment === "object" ? asset.assignedDepartment : null;

  return (
    <ResponsiveDialog open={!!asset} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[85vh] overflow-y-auto">
        {asset && (
          <>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle className="flex flex-wrap items-center gap-2">
                {asset.name}
                <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", ASSET_STATUS_STYLES[asset.status])}>
                  {ASSET_STATUS_LABELS[asset.status]}
                </span>
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
                {asset.assetTag} · {assetCategoryLabel(asset.category)}
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>

            <div className="space-y-5 px-4 pb-4 sm:px-0">
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 text-xs text-muted-foreground">Held by</p>
                {person ? (
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{getInitials(person.name)}</div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{person.name}</p>
                      <p className="text-xs text-muted-foreground">{[person.employeeCode, person.designation].filter(Boolean).join(" · ") || "Person"} · since {fmtDate(asset.assignedDate)}</p>
                    </div>
                  </div>
                ) : dept ? (
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground"><Building2 className="h-4 w-4" aria-hidden /></div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{dept.name}</p>
                      <p className="text-xs text-muted-foreground">Department · since {fmtDate(asset.assignedDate)}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Nobody — it isn&apos;t issued.</p>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Row label="Condition"><span className={cn("font-medium", ASSET_CONDITION_STYLES[asset.condition])}>{ASSET_CONDITION_LABELS[asset.condition]}</span></Row>
                <Row label="Quantity">{(asset.quantity ?? 1) > 1 ? `${asset.quantity} items` : "1"}</Row>
                <Row label="Office">{asset.branch}</Row>
                <Row label="Location">{asset.location}</Row>
                <Row label="Serial number">{asset.serialNumber}</Row>
                <Row label="Purchase date">{asset.purchaseDate ? fmtDate(asset.purchaseDate) : ""}</Row>
                <Row label="Purchase cost">{asset.purchaseCost != null ? asset.purchaseCost.toLocaleString() : ""}</Row>
                <Row label="Added">{fmtDate(asset.createdAt)}</Row>
              </dl>

              {asset.notes && (
                <div>
                  <p className="text-xs text-muted-foreground">Notes</p>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {asset.notes.split(" · ").map((n, i) => <li key={i} className="break-words">{n}</li>)}
                  </ul>
                </div>
              )}

              <div>
                <p className="mb-2 text-xs text-muted-foreground">History</p>
                {!asset.history.length ? (
                  <p className="rounded-lg border border-dashed border-border py-4 text-center text-sm text-muted-foreground">No history yet.</p>
                ) : (
                  <div className="space-y-2">
                    {[...asset.history].reverse().map((h, i) => {
                      const who = h.employee && typeof h.employee === "object" ? h.employee.name
                        : h.department && typeof h.department === "object" ? `${h.department.name} (department)` : null;
                      return (
                        <div key={i} className="rounded-lg border border-border p-2.5 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium capitalize">{h.action.replace(/_/g, " ")}</span>
                            <span className="text-xs text-muted-foreground">{fmtDate(h.date)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {[who, h.condition ? ASSET_CONDITION_LABELS[h.condition] : null].filter(Boolean).join(" · ") || "—"}
                          </p>
                          {h.notes && <p className="mt-1 text-xs text-muted-foreground">{h.notes}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
