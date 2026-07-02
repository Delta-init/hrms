"use client";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { TableQuery } from "@/hooks/useTableQuery";

interface Props {
  query: TableQuery;
  placeholder?: string;
  children?: React.ReactNode; // extra filter controls (right)
}

/** Lightweight toolbar for card-grid pages: server-side search + optional filters. */
export function CardToolbar({ query, placeholder = "Search…", children }: Props) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query.search} onChange={(e) => query.setSearch(e.target.value)} placeholder={placeholder} className="h-9 pl-9" />
      </div>
      {children}
    </div>
  );
}
