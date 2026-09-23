"use client";
import { useState } from "react";
import { AsyncSelect, type AsyncSelectOption } from "@/components/ui/async-select";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useEmployees } from "@/hooks/useEmployees";
import { useUsers } from "@/hooks/useUsers";
import { useDepartments } from "@/hooks/useDepartments";
import { useWorkSchedules } from "@/hooks/useWorkSchedules";
import { useSalaryStructures } from "@/hooks/useSalaryStructures";
import { useLetterTemplates } from "@/hooks/useLetters";
import { LETTER_CATEGORY_LABELS } from "@/types";

/**
 * Entity pickers.
 *
 * Each wraps AsyncSelect with the query for one record type. Search runs on the
 * server, so these show every match rather than filtering a page-capped array
 * the way the plain dropdowns did — `useUsers({ limit: "200" })` was silently
 * clamped to 100 by the API, so anyone past that simply could not be picked.
 */

/** How many rows a picker requests per search. Deliberately small — you narrow by typing. */
const PAGE = "25";

interface BaseProps {
  value?: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  /** Label for a value that isn't in the loaded page (edit forms). */
  selectedLabel?: string;
  /** Per-option badge / disabled state, e.g. "already a member". */
  decorate?: (option: AsyncSelectOption) => AsyncSelectOption;
  className?: string;
}

/** Shared search state + optional per-row decoration. */
function usePickerState(decorate?: BaseProps["decorate"]) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 250);
  const apply = (opts: AsyncSelectOption[]) => (decorate ? opts.map(decorate) : opts);
  return { search, setSearch, debounced, apply };
}

export function EmployeeSelect({
  placeholder = "Select employee…", decorate, activeOnly = true, ...rest
}: BaseProps & { /** Hide leavers. On by default — you rarely pick one. */ activeOnly?: boolean }) {
  const { search, setSearch, debounced, apply } = usePickerState(decorate);
  const { data, isFetching } = useEmployees({
    limit: PAGE,
    ...(activeOnly ? { excludeTerminated: "true" } : {}),
    ...(debounced ? { search: debounced } : {}),
  });
  const options = apply(
    (data?.data ?? []).map((e) => ({ value: e._id, label: e.name, sub: e.employeeCode }))
  );
  return (
    <AsyncSelect
      {...rest}
      options={options}
      loading={isFetching}
      search={search}
      onSearchChange={setSearch}
      placeholder={placeholder}
      searchPlaceholder="Search by name or code…"
      emptyText="No employees found."
    />
  );
}

/** Searchable employee filter that keeps the popover open while choosing several people. */
export function EmployeeMultiSelect({ value, onChange, placeholder = "All employees", className, activeOnly = true }: {
  value: string[]; onChange: (value: string[]) => void; placeholder?: string; className?: string; activeOnly?: boolean;
}) {
  const { search, setSearch, debounced } = usePickerState();
  const { data, isFetching } = useEmployees({ limit: PAGE, ...(activeOnly ? { excludeTerminated: "true" } : {}), ...(debounced ? { search: debounced } : {}) });
  // Leave requests are keyed by the linked login User ID, not the Employee ID.
  // Employees without a login cannot own a leave request, so they are not filter options.
  const options = (data?.data ?? []).flatMap((e) => {
    const userId = typeof e.user === "object" && e.user ? e.user._id : typeof e.user === "string" ? e.user : "";
    return userId ? [{ value: userId, label: e.name, sub: e.employeeCode }] : [];
  });
  const names = options.filter((o) => value.includes(o.value)).map((o) => o.label);
  const label = value.length === 0 ? placeholder : value.length === 1 ? (names[0] ?? "1 employee selected") : `${value.length} employees selected`;
  return (
    <Popover>
      <PopoverTrigger asChild><Button type="button" variant="outline" className={cn("justify-between font-normal", className)}><span className="truncate">{label}</span><ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" /></Button></PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b border-border px-3"><Search className="mr-2 h-4 w-4 opacity-50"/><CommandInput value={search} onValueChange={setSearch} placeholder="Search employees…"/>{isFetching && <Loader2 className="ml-2 h-3.5 w-3.5 animate-spin"/>}</div>
          <CommandList className="max-h-64"><CommandEmpty>No employees found.</CommandEmpty><CommandGroup>
            {options.map((o) => { const checked = value.includes(o.value); return <CommandItem key={o.value} value={o.value} onSelect={() => onChange(checked ? value.filter((id) => id !== o.value) : [...value, o.value])} className="gap-2"><span className={cn("flex h-4 w-4 items-center justify-center rounded border", checked ? "border-primary bg-primary text-primary-foreground" : "border-input")}>{checked && <Check className="h-3 w-3"/>}</span><span className="min-w-0 flex-1 truncate">{o.label}<span className="ml-1 text-xs text-muted-foreground">{o.sub}</span></span></CommandItem>; })}
          </CommandGroup></CommandList>
          {value.length > 0 && <div className="border-t border-border p-2"><Button type="button" size="sm" variant="ghost" className="h-7 w-full" onClick={() => onChange([])}>Clear selection ({value.length})</Button></div>}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function UserSelect({ placeholder = "Select user…", decorate, ...rest }: BaseProps) {
  const { search, setSearch, debounced, apply } = usePickerState(decorate);
  const { data, isFetching } = useUsers({ limit: PAGE, ...(debounced ? { search: debounced } : {}) });
  const options = apply(
    (data?.data ?? []).map((u) => ({ value: u._id, label: u.name, sub: u.email }))
  );
  return (
    <AsyncSelect
      {...rest}
      options={options}
      loading={isFetching}
      search={search}
      onSearchChange={setSearch}
      placeholder={placeholder}
      searchPlaceholder="Search by name or email…"
      emptyText="No users found."
    />
  );
}

export function DepartmentSelect({ placeholder = "Select department…", decorate, ...rest }: BaseProps) {
  const { search, setSearch, debounced, apply } = usePickerState(decorate);
  const { data, isFetching } = useDepartments({ limit: PAGE, ...(debounced ? { search: debounced } : {}) });
  const options = apply(
    (data?.data ?? []).map((d) => ({ value: d._id, label: d.name, sub: d.code }))
  );
  return (
    <AsyncSelect
      {...rest}
      options={options}
      loading={isFetching}
      search={search}
      onSearchChange={setSearch}
      placeholder={placeholder}
      searchPlaceholder="Search departments…"
      emptyText="No departments found."
    />
  );
}

export function WorkScheduleSelect({ placeholder = "Select schedule…", decorate, ...rest }: BaseProps) {
  const { search, setSearch, debounced, apply } = usePickerState(decorate);
  const { data, isFetching } = useWorkSchedules({ limit: PAGE, ...(debounced ? { search: debounced } : {}) });
  const options = apply(
    (data?.data ?? []).map((s) => ({ value: s._id, label: s.name, sub: s.timeZone }))
  );
  return (
    <AsyncSelect
      {...rest}
      options={options}
      loading={isFetching}
      search={search}
      onSearchChange={setSearch}
      placeholder={placeholder}
      searchPlaceholder="Search schedules…"
      emptyText="No work schedules found."
    />
  );
}

export function SalaryStructureSelect({ placeholder = "Select structure…", decorate, ...rest }: BaseProps) {
  const { search, setSearch, debounced, apply } = usePickerState(decorate);
  const { data, isFetching } = useSalaryStructures({ limit: PAGE, ...(debounced ? { search: debounced } : {}) });
  const options = apply(
    (data?.data ?? []).map((s) => ({ value: s._id, label: s.name }))
  );
  return (
    <AsyncSelect
      {...rest}
      options={options}
      loading={isFetching}
      search={search}
      onSearchChange={setSearch}
      placeholder={placeholder}
      searchPlaceholder="Search structures…"
      emptyText="No salary structures found."
    />
  );
}

export function LetterTemplateSelect({ placeholder = "Select template…", decorate, ...rest }: BaseProps) {
  const { search, setSearch, debounced, apply } = usePickerState(decorate);
  const { data, isFetching } = useLetterTemplates(debounced ? { search: debounced } : undefined);
  const options = apply(
    (data ?? [])
      .filter((t) => t.status === "active")
      .map((t) => ({ value: t._id, label: t.name, sub: LETTER_CATEGORY_LABELS[t.category] }))
  );
  return (
    <AsyncSelect
      {...rest}
      options={options}
      loading={isFetching}
      search={search}
      onSearchChange={setSearch}
      placeholder={placeholder}
      searchPlaceholder="Search templates…"
      emptyText="No templates found."
    />
  );
}

/**
 * Reporting-line picker.
 *
 * A manager may be recorded as an Employee or as a login User, so this searches
 * both and emits the composite "Kind:id" value the employee form round-trips.
 * Employees are listed first — they're the normal choice; a User entry only
 * appears on the org chart if that account is linked to an employee record.
 */
export function ManagerSelect({
  placeholder = "Select manager…", excludeEmployeeId, decorate, ...rest
}: BaseProps & { /** Keeps someone from reporting to themselves. */ excludeEmployeeId?: string }) {
  const { search, setSearch, debounced, apply } = usePickerState(decorate);
  const q: Record<string, string> = debounced ? { search: debounced } : {};
  const { data: empData, isFetching: loadingEmps } = useEmployees({ limit: PAGE, excludeTerminated: "true", ...q });
  const { data: userData, isFetching: loadingUsers } = useUsers({ limit: PAGE, ...q });

  const options = apply([
    ...(empData?.data ?? [])
      .filter((e) => e._id !== excludeEmployeeId)
      .map((e) => ({ value: `Employee:${e._id}`, label: e.name, sub: e.employeeCode })),
    ...(userData?.data ?? []).map((u) => ({ value: `User:${u._id}`, label: u.name, sub: `${u.email} · user` })),
  ]);

  return (
    <AsyncSelect
      {...rest}
      options={options}
      loading={loadingEmps || loadingUsers}
      search={search}
      onSearchChange={setSearch}
      placeholder={placeholder}
      searchPlaceholder="Search people…"
      emptyText="No one found."
    />
  );
}
