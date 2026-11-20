"use client";
import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type AsyncSelectTone = "neutral" | "warn" | "info";

export interface AsyncSelectOption {
  value: string;
  label: string;
  /** Secondary line — employee code, email, department… */
  sub?: string;
  /** Shown on the right; pair with `disabled` to explain why a row is blocked. */
  badge?: { label: string; tone?: AsyncSelectTone };
  disabled?: boolean;
}

interface Props {
  value?: string | null;
  onChange: (value: string) => void;
  options: AsyncSelectOption[];
  loading?: boolean;
  /** Current search term — owned by the caller, which runs the query. */
  search: string;
  onSearchChange: (term: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** Renders a clear affordance once something is picked. */
  allowClear?: boolean;
  /**
   * Label for the current value when it isn't in the loaded page — needed when
   * editing a record whose selection sits outside the first page of results.
   */
  selectedLabel?: string;
  className?: string;
  /** Keeps the panel open after choosing, for multi-select callers. */
  stayOpenOnSelect?: boolean;
}

const toneClass: Record<AsyncSelectTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  info: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
};

/**
 * Searchable select backed by a server query.
 *
 * The caller owns fetching and passes `options` plus the controlled `search`
 * term, so results are filtered by the API rather than by trimming a capped
 * client-side array — the pattern the old dropdowns used, which silently hid
 * anyone past the page limit.
 *
 * Filtering is disabled on the command list (`shouldFilter={false}`) because the
 * server has already done it; leaving it on would filter the results a second
 * time against the raw query and drop legitimate matches.
 */
export function AsyncSelect({
  value, onChange, options, loading, search, onSearchChange,
  placeholder = "Select…", searchPlaceholder = "Search…", emptyText = "No results.",
  disabled, allowClear, selectedLabel, className, stayOpenOnSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  // Remember the chosen row so the trigger keeps its label when the result set
  // changes underneath it (e.g. the user types a new search afterwards).
  const [lastPicked, setLastPicked] = useState<AsyncSelectOption | null>(null);

  useEffect(() => {
    if (!value) setLastPicked(null);
  }, [value]);

  const current =
    options.find((o) => o.value === value) ??
    (lastPicked?.value === value ? lastPicked : null);
  const display = current ? [current.label, current.sub].filter(Boolean).join(" · ") : selectedLabel;

  return (
    // Modal, so the list scrolls inside a dialog: a dialog locks scrolling everywhere outside its own box, and this
    // list is drawn on a layer outside it — open in the Issue Asset dialog, the department list wouldn't scroll
    // (2026-11-20). A modal popover takes the scroll lock for itself while it's open.
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className={cn("truncate", !display && "text-muted-foreground")}>{display || placeholder}</span>
          <span className="ml-2 flex shrink-0 items-center gap-1">
            {allowClear && value ? (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Clear selection"
                onClick={(e) => { e.stopPropagation(); onChange(""); }}
                className="rounded p-0.5 opacity-60 hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            ) : null}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          {/* CommandInput brings its own search icon and rule; this only adds the spinner beside it. */}
          <div className="relative">
            <CommandInput
              value={search}
              onValueChange={onSearchChange}
              placeholder={searchPlaceholder}
              className="pr-7"
            />
            {loading && <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
          {/* Never taller than the room left on screen, so the last rows can always be scrolled to. */}
          <CommandList className="max-h-[min(16rem,calc(var(--radix-popover-content-available-height)-3.5rem))] overflow-y-auto overscroll-contain">
            {!loading && options.length === 0 && <CommandEmpty>{emptyText}</CommandEmpty>}
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  disabled={o.disabled}
                  onSelect={() => {
                    if (o.disabled) return;
                    setLastPicked(o);
                    onChange(o.value);
                    if (!stayOpenOnSelect) setOpen(false);
                  }}
                  className={cn("gap-2", o.disabled && "cursor-not-allowed")}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {o.label}
                    {o.sub && <span className="ml-1.5 text-xs text-muted-foreground">{o.sub}</span>}
                  </span>
                  {o.badge ? (
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", toneClass[o.badge.tone ?? "neutral"])}>
                      {o.badge.label}
                    </span>
                  ) : value === o.value ? (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
