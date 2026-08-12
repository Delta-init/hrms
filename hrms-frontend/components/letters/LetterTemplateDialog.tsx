"use client";
import { useEffect, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, ChevronDown, Sparkles } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { letterTemplateFormSchema, type LetterTemplateFormValues } from "@/lib/validations/letterSchema";
import { useCreateLetterTemplate, useUpdateLetterTemplate } from "@/hooks/useLetters";
import { MERGE_TOKENS } from "@/lib/mergeTokens";
import { LETTER_PRESETS, presetByKey } from "@/lib/letterPresets";
import { LETTER_CATEGORY_LABELS, type LetterTemplate, type LetterCategory } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: LetterTemplate | null;
  /** Opened straight from a preset — the form starts on that draft. */
  presetKey?: string | null;
}

const EMPTY: LetterTemplateFormValues = { name: "", category: "other", subject: "", body: "", status: "active" };

export function LetterTemplateDialog({ open, onOpenChange, template, presetKey }: Props) {
  const isEditing = !!template;
  const { mutate: create, isPending: creating } = useCreateLetterTemplate();
  const { mutate: update, isPending: updating } = useUpdateLetterTemplate();
  const isPending = creating || updating;
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const { register, handleSubmit, control, reset, setValue, getValues, formState: { errors } } = useForm<LetterTemplateFormValues>({
    resolver: zodResolver(letterTemplateFormSchema),
    defaultValues: EMPTY,
  });
  const { ref: bodyFormRef, ...bodyField } = register("body");

  const applyPreset = (key: string) => {
    const p = presetByKey(key);
    if (!p) return;
    // Name included: a preset the user never renames still gets a sensible one,
    // and the unique-name error makes it obvious when they already have it.
    reset({ name: p.name, category: p.category, subject: p.subject, body: p.body, status: "active" });
  };

  useEffect(() => {
    if (!open) return;
    if (template) {
      reset({ name: template.name, category: template.category, subject: template.subject ?? "", body: template.body, status: template.status });
    } else if (presetKey) {
      applyPreset(presetKey);
    } else {
      reset(EMPTY);
    }
    // applyPreset closes over `reset`, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template, presetKey, reset]);

  const insertToken = (token: string) => {
    const el = bodyRef.current;
    const current = getValues("body") ?? "";
    if (!el) { setValue("body", `${current}${token}`); return; }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`;
    setValue("body", next, { shouldDirty: true });
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + token.length; });
  };

  const onSubmit = (data: LetterTemplateFormValues) => {
    const payload = { ...data, subject: data.subject || undefined };
    if (isEditing) update({ id: template._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Letter Template" : "New Letter Template"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          {/* Only when creating. Offering to overwrite a saved template with a
              preset is a good way to lose somebody's wording by accident. */}
          {!isEditing && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
              <div>
                <p className="text-sm font-medium">Start from a preset</p>
                <p className="text-xs text-muted-foreground">A ready-written draft you can edit before saving.</p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="gap-1">
                    <Sparkles className="h-3.5 w-3.5" />Choose<ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
                  {LETTER_PRESETS.map((p) => (
                    <DropdownMenuItem key={p.key} onSelect={() => applyPreset(p.key)} className="cursor-pointer flex-col items-start gap-0.5">
                      <span className="text-sm font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">{p.when}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" placeholder="e.g. Offer Letter" {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Category *</Label>
              <Controller name="category" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(LETTER_CATEGORY_LABELS) as LetterCategory[]).map((k) => <SelectItem key={k} value={k}>{LETTER_CATEGORY_LABELS[k]}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="subject">Subject</Label>
            <Input id="subject" placeholder="Optional — supports merge fields too, e.g. Offer of Employment — {{employee.name}}" {...register("subject")} />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="body">Body *</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs">Insert field<ChevronDown className="h-3 w-3" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                  {MERGE_TOKENS.map((t) => (
                    <DropdownMenuItem key={t.token} onSelect={() => insertToken(t.token)} className="cursor-pointer font-mono text-xs">
                      {t.token} <span className="ml-2 font-sans text-muted-foreground">— {t.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Textarea
              id="body" rows={12} placeholder={"Dear {{employee.name}},\n\nWe are pleased to..."}
              className="font-mono text-xs"
              {...bodyField}
              ref={(el) => { bodyFormRef(el); bodyRef.current = el; }}
            />
            {errors.body && <p className="text-xs text-destructive">{errors.body.message}</p>}
            <p className="text-xs text-muted-foreground">Use the &quot;Insert field&quot; menu to add merge tokens — they&apos;re replaced with the employee&apos;s real details when a letter is generated.</p>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Controller name="status" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            )} />
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isEditing ? "Save Changes" : "Create Template"}</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
