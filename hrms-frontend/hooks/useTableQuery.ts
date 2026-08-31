"use client";
import { useState, useMemo, useEffect, useCallback } from "react";

export interface UseTableQueryOptions {
  defaultSortBy?: string;
  defaultSortOrder?: "asc" | "desc";
  defaultLimit?: number;
  /**
   * Filters the table starts with, and returns to when cleared.
   *
   * For a list whose natural default is narrower than "everything" — the
   * employee register holds sixty people who have left, and showing them by
   * default made it read as twice the size of the company.
   */
  defaultFilters?: Record<string, string>;
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
  const [filters, setFilters_] = useState<Record<string, string>>(opts.defaultFilters ?? {});

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const setLimit = useCallback((n: number) => { setLimitState(n); setPage(1); }, []);

  const setFilter = useCallback((key: string, value: string) => {
    setFilters_((prev) => {
      const next = { ...prev };
      if (!value || value === ALL) delete next[key];
      else next[key] = value;
      return next;
    });
    setPage(1);
  }, []);

  /** Apply several filters at once. Setting them one by one re-rendered — and
   *  refetched — between each, so a date range briefly queried a half-range. */
  const setFilters = useCallback((patch: Record<string, string | undefined>) => {
    setFilters_((prev) => {
      const next = { ...prev };
      for (const [key, value] of Object.entries(patch)) {
        if (!value || value === ALL) delete next[key];
        else next[key] = value;
      }
      return next;
    });
    setPage(1);
  }, []);

  // Back to the defaults, not to nothing — clearing a list that starts on
  // "current staff" should not silently start including everyone who has left.
  const defaults = opts.defaultFilters;
  const clearFilters = useCallback(() => {
    setFilters_(defaults ?? {});
    setSearch("");
    setDebouncedSearch("");
    setPage(1);
    // A literal written at the call site; re-running on identity would reset
    // the table on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(defaults ?? {})]);

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

  /**
   * How many filters the reader has actually chosen.
   *
   * A default does not count. Otherwise a list that starts on "current staff"
   * opens showing "1 filter" and a Clear button that appears to do nothing —
   * it is already in the state it clears to.
   */
  const activeFilterCount =
    Object.entries(filters).filter(([k, v]) => (defaults?.[k] ?? undefined) !== v).length +
    (debouncedSearch ? 1 : 0);

  return {
    page, setPage,
    limit, setLimit,
    search, setSearch,
    debouncedSearch,
    sortBy, sortOrder, toggleSort,
    filters, setFilter, setFilters, clearFilters,
    params,
    activeFilterCount,
  };
}

export type TableQuery = ReturnType<typeof useTableQuery>;
