"use client";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PaginationMeta } from "@/types";

interface Props {
  pagination?: PaginationMeta;
  page: number;
  limit: number;
  onPageChange: (p: number) => void;
  onLimitChange: (n: number) => void;
  label?: string;
}

const PAGE_SIZES = [10, 25, 50, 100];

export function Pagination({ pagination, page, limit, onPageChange, onLimitChange, label = "rows" }: Props) {
  const total = pagination?.total ?? 0;
  const totalPages = pagination?.totalPages ?? 1;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm sm:flex-row">
      <div className="flex items-center gap-4 text-muted-foreground">
        <span>{total === 0 ? `No ${label}` : `${from}–${to} of ${total} ${label}`}</span>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline">Rows</span>
          <Select value={String(limit)} onValueChange={(v) => onLimitChange(Number(v))}>
            <SelectTrigger className="h-8 w-[72px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPageChange(1)}><ChevronsLeft className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={!pagination?.hasPrevPage} onClick={() => onPageChange(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="px-2 text-muted-foreground">Page <span className="font-medium text-foreground">{page}</span> of {totalPages}</span>
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={!pagination?.hasNextPage} onClick={() => onPageChange(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => onPageChange(totalPages)}><ChevronsRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
