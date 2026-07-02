"use client";
import { useState, useMemo, useEffect, useCallback } from "react";

export interface UseTableQueryOptions {
  defaultSortBy?: string;
  defaultSortOrder?: "asc" | "desc";
  defaultLimit?: number;
}

const ALL = "__all__";

/**
 * Server-side table query state: page, limit, debounced search, sort, and an
 * arbitrary filters map. Returns a `params` object to pass straight to a data
 * hook (React Query). Page auto-resets when search/filters/sort change.
 */
export function useTableQuery(opts: UseTableQueryOptions = {}) {
  const [page, setPage] = useState(1);
  const [limit, setLimitState] = useState(opts.defaultLimit ?? 10);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState(opts.defaultSortBy ?? "createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(opts.defaultSortOrder ?? "desc");
  const [filters, setFilters] = useState<Record<string, string>>({});

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const setLimit = useCallback((n: number) => { setLimitState(n); setPage(1); }, []);

  const setFilter = useCallback((key: string, value: string) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (!value || value === ALL) delete next[key];
      else next[key] = value;
      return next;
    });
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
    setSearch("");
    setDebouncedSearch("");
    setPage(1);
  }, []);

  const toggleSort = useCallback((field: string) => {
    setSortBy((prev) => {
      if (prev === field) {
        setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortOrder("asc");
      return field;
    });
    setPage(1);
  }, []);

  const params = useMemo(() => {
    const p: Record<string, string> = {
      page: String(page),
      limit: String(limit),
      sortBy,
      sortOrder,
    };
    if (debouncedSearch) p.search = debouncedSearch;
    return { ...p, ...filters };
  }, [page, limit, sortBy, sortOrder, debouncedSearch, filters]);

  const activeFilterCount = Object.keys(filters).length + (debouncedSearch ? 1 : 0);

  return {
    page, setPage,
    limit, setLimit,
    search, setSearch,
    debouncedSearch,
    sortBy, sortOrder, toggleSort,
    filters, setFilter, clearFilters,
    params,
    activeFilterCount,
  };
}

export type TableQuery = ReturnType<typeof useTableQuery>;
