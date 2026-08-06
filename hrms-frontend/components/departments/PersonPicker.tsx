"use client";
import { useState } from "react";
import { Check, ChevronsUpDown, Search, UserRound, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { PersonKind } from "@/types";

export interface PickerPerson {
  key: string;
  kind: PersonKind;
  id: string;
  label: string;
  sub: string;
  /** Department this person already belongs to, if any. */
  deptId?: string | null;
  deptName?: string | null;
}

/** Why a person can't be picked right now — rendered as a badge on their row. */
export type BlockedReason = { label: string; tone: "leader" | "member" | "other-dept" } | null;

interface Props {
  people: PickerPerson[];
  value?: string | null;
  onSelect: (key: string) => void;
  /** Return a reason to show a badge and make the row unselectable. */
  blockedFor: (p: PickerPerson) => BlockedReason;
  placeholder: string;
  searchPlaceholder?: string;
  /** Keeps the popover open after choosing — used by the multi-select members picker. */
  stayOpenOnSelect?: boolean;
}

const toneClass: Record<NonNullable<BlockedReason>["tone"], string> = {
  leader: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  member: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  "other-dept": "bg-muted text-muted-foreground",
};

/**
 * Searchable person picker.
 *
 * Blocked people stay in the list rather than being filtered out, so it is
 * visible *why* someone can't be chosen — "already the team leader", "already a
 * member", or the department they belong to — instead of them silently not
 * being there.
 */
export function PersonPicker({
  people, value, onSelect, blockedFor, placeholder, searchPlaceholder = "Search by name or code…", stayOpenOnSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = people.find((p) => p.key === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? `${selected.label} · ${selected.sub}` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          // Match on name, code/email and kind so "eng", "EMP-004" and a name all work.
          filter={(itemValue, search) => (itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
        >
          <div className="flex items-center border-b border-border px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <CommandInput placeholder={searchPlaceholder} className="border-0" />
          </div>
          <CommandList className="max-h-64">
            <CommandEmpty>No one found.</CommandEmpty>
            <CommandGroup>
              {people.map((p) => {
                const blocked = blockedFor(p);
                return (
                  <CommandItem
                    key={p.key}
                    // Searchable haystack — cmdk matches against this string.
                    value={`${p.label} ${p.sub} ${p.kind}`}
                    disabled={!!blocked}
                    onSelect={() => {
                      if (blocked) return;
                      onSelect(p.key);
                      if (!stayOpenOnSelect) setOpen(false);
                    }}
                    className={cn("gap-2", blocked && "cursor-not-allowed")}
                  >
                    {p.kind === "Employee"
                      ? <UserRound className="h-3.5 w-3.5 text-primary" />
                      : <UserIcon className="h-3.5 w-3.5 text-indigo-500" />}
                    <span className="min-w-0 flex-1 truncate">
                      {p.label}
                      <span className="ml-1.5 text-xs text-muted-foreground">{p.sub}</span>
                    </span>
                    {blocked ? (
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", toneClass[blocked.tone])}>
                        {blocked.label}
                      </span>
                    ) : value === p.key ? (
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
