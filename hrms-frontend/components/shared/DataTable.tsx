"use client";
import { useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, SlidersHorizontal, Columns3, GripVertical, ArrowUp, ArrowDown,
  ChevronsUpDown, X, Loader2, Check, FileSpreadsheet,
} from "lucide-react";
import { exportToExcel, type ExcelRow } from "@/lib/excel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { TableQuery } from "@/hooks/useTableQuery";
import type { PaginationMeta } from "@/types";
import { Pagination } from "./Pagination";

export interface DataTableColumn<T> {
  id: string;
  label: string;
  defaultVisible?: boolean;
  alwaysVisible?: boolean;
  sortKey?: string;
  align?: "left" | "right" | "center";
  className?: string;
  headerClassName?: string;
  render: (row: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  tableId: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  pagination?: PaginationMeta;
  query: TableQuery;
  searchable?: boolean;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  emptyText?: string;
  rowLabel?: string;
  minWidth?: number;
  /** When provided, shows an "Export" button that writes the current rows to Excel. */
  exportMapper?: (row: T) => ExcelRow;
  exportName?: string;
}

export function DataTable<T>({
  tableId, columns, rows, rowKey, loading, pagination, query,
  searchable = true, searchPlaceholder = "Search…", filters, actions,
  emptyText = "No records found.", rowLabel = "rows", minWidth = 720,
  exportMapper, exportName = "export",
}: DataTableProps<T>) {
  const LS_VIS = `hrms_dt_${tableId}_visible`;
  const LS_ORD = `hrms_dt_${tableId}_order`;
  const defaultVisible = useMemo(() => new Set(columns.filter((c) => c.defaultVisible !== false).map((c) => c.id)), [columns]);
  const defaultOrder = useMemo(() => columns.map((c) => c.id), [columns]);

  const [visible, setVisible] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return defaultVisible;
    try {
      const s = localStorage.getItem(LS_VIS);
      if (s) return new Set(JSON.parse(s) as string[]);
    } catch { /* ignore */ }
    return defaultVisible;
  });
  const [order, setOrder] = useState<string[]>(() => {
    if (typeof window === "undefined") return defaultOrder;
    try {
      const s = localStorage.getItem(LS_ORD);
      if (s) {
        const saved = JSON.parse(s) as string[];
        const all = defaultOrder;
        // keep saved order, append any new columns
        return [...saved.filter((id) => all.includes(id)), ...all.filter((id) => !saved.includes(id))];
      }
    } catch { /* ignore */ }
    return defaultOrder;
  });
  const [showFilters, setShowFilters] = useState(false);

  const byId = useMemo(() => Object.fromEntries(columns.map((c) => [c.id, c])), [columns]);
  const orderedColumns = useMemo(() => order.map((id) => byId[id]).filter(Boolean) as DataTableColumn<T>[], [order, byId]);
  const visibleColumns = orderedColumns.filter((c) => c.alwaysVisible || visible.has(c.id));

  const persistVisible = (s: Set<string>) => { try { localStorage.setItem(LS_VIS, JSON.stringify(Array.from(s))); } catch { /* ignore */ } };
  const persistOrder = (o: string[]) => { try { localStorage.setItem(LS_ORD, JSON.stringify(o)); } catch { /* ignore */ } };

  const toggleColumn = (id: string) => setVisible((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    persistVisible(next);
    return next;
  });

  // HTML5 drag reorder
  const dragId = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const onDrop = (targetId: string) => {
    const src = dragId.current;
    if (!src || src === targetId) { setDragOver(null); return; }
    setOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(src), to = next.indexOf(targetId);
      if (from === -1 || to === -1) return prev;
      next.splice(from, 1); next.splice(to, 0, src);
      persistOrder(next);
      return next;
    });
    dragId.current = null; setDragOver(null);
  };
  const resetColumns = () => { setOrder(defaultOrder); setVisible(defaultVisible); persistOrder(defaultOrder); persistVisible(defaultVisible); };

  const align = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {searchable && (
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query.search} onChange={(e) => query.setSearch(e.target.value)} placeholder={searchPlaceholder} className="h-9 pl-9" />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {filters && (
            <Button variant="outline" size="sm" className="h-9 gap-2" onClick={() => setShowFilters((v) => !v)}>
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Filters</span>
              {query.activeFilterCount > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{query.activeFilterCount}</span>}
            </Button>
          )}

          {/* Columns */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-2"><Columns3 className="h-3.5 w-3.5" /><span className="hidden sm:inline">Columns</span></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
              <div className="px-2 py-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Columns</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground/60">Toggle · Drag to reorder</p>
              </div>
              <DropdownMenuSeparator />
              <div className="py-1">
                {orderedColumns.filter((c) => !c.alwaysVisible).map((c) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => { dragId.current = c.id; }}
                    onDragOver={(e) => { e.preventDefault(); if (dragId.current && dragId.current !== c.id) setDragOver(c.id); }}
                    onDrop={(e) => { e.preventDefault(); onDrop(c.id); }}
                    onDragEnd={() => { dragId.current = null; setDragOver(null); }}
                    className={cn("mx-1 flex cursor-grab select-none items-center gap-2 rounded px-2 py-1.5 transition-colors active:cursor-grabbing",
                      dragOver === c.id ? "border border-primary/40 bg-primary/15" : "hover:bg-muted/60")}
                  >
                    <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                    <span className="flex-1 cursor-pointer text-sm" onClick={(e) => { e.stopPropagation(); toggleColumn(c.id); }}>{c.label}</span>
                    <div
                      className={cn("flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border transition-colors", visible.has(c.id) ? "border-primary bg-primary" : "border-border")}
                      onClick={(e) => { e.stopPropagation(); toggleColumn(c.id); }}
                    >
                      {visible.has(c.id) && <Check className="h-2.5 w-2.5 text-primary-foreground" strokeWidth={3} />}
                    </div>
                  </div>
                ))}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); resetColumns(); }} className="text-xs text-muted-foreground">Reset to default</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {exportMapper && (
            <Button variant="outline" size="sm" className="h-9 gap-2" disabled={!rows.length}
              onClick={() => exportToExcel(exportName, rows.map(exportMapper))}>
              <FileSpreadsheet className="h-3.5 w-3.5" /><span className="hidden sm:inline">Export</span>
            </Button>
          )}
          {query.activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" className="h-9 gap-1.5 text-muted-foreground" onClick={query.clearFilters}><X className="h-3.5 w-3.5" />Clear</Button>
          )}
          {actions}
        </div>
      </div>

      {/* Filter panel */}
      {filters && (
        <AnimatePresence initial={false}>
          {showFilters && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
              <Card className="flex flex-wrap items-end gap-3 p-4">{filters}</Card>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth }}>
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                {visibleColumns.map((c) => {
                  const activeSort = c.sortKey && query.sortBy === c.sortKey;
                  return (
                    <th key={c.id} className={cn("px-5 py-3 font-semibold", align(c.align), c.headerClassName)}>
                      {c.sortKey ? (
                        <button type="button" onClick={() => query.toggleSort(c.sortKey!)} className={cn("inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground", activeSort && "text-primary")}>
                          {c.label}
                          {activeSort ? (query.sortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                        </button>
                      ) : c.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-5 py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-5 py-16 text-center text-muted-foreground">{emptyText}</td></tr>
              ) : (
                rows.map((row, i) => (
                  <motion.tr key={rowKey(row)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.02, 0.3) }} className="hover:bg-muted/30">
                    {visibleColumns.map((c) => (
                      <td key={c.id} className={cn("px-5 py-3.5", align(c.align), c.className)}>{c.render(row)}</td>
                    ))}
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination pagination={pagination} page={query.page} limit={query.limit} onPageChange={query.setPage} onLimitChange={query.setLimit} label={rowLabel} />
      </Card>
    </div>
  );
}
