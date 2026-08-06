"use client";
import { useEffect } from "react";
import { useForm, useFieldArray, Controller, type Control, type UseFormRegister } from "react-hook-form";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DepartmentSelect, ManagerSelect } from "@/components/pickers";
import { useUpdateEmployee, useUpdateMyProfile } from "@/hooks/useEmployees";
import {
  BLOOD_GROUPS, EMPLOYEE_STATUS_LABELS, GENDER_LABELS, MARITAL_LABELS, TITLE_LABELS, VISA_TYPES,
  type Employee, type EmployeeStatus, type Gender, type MaritalStatus, type Title,
} from "@/types";

export type ProfileSection =
  | "personal" | "employment" | "bank" | "education"
  | "currentAddress" | "permanentAddress" | "emergency"
  | "family" | "passport" | "visa" | "labourCard" | "emiratesId";

const SECTION_TITLES: Record<ProfileSection, string> = {
  personal: "Personal details",
  employment: "Employment details",
  bank: "Bank details",
  education: "Education",
  currentAddress: "Current address",
  permanentAddress: "Permanent address",
  emergency: "Emergency contacts",
  family: "Family members",
  passport: "Passport details",
  visa: "Visa details",
  labourCard: "Labour card",
  emiratesId: "Emirates ID",
};

const NONE = "__none__";
const idOf = (v: unknown) => (v && typeof v === "object" ? (v as { _id: string })._id : (v as string) || "");
const toDateInput = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

type FormValues = Record<string, unknown>;

/** Build the form's default values for a given section from the employee. */
function defaultsFor(section: ProfileSection, e: Employee): FormValues {
  switch (section) {
    case "personal":
      return {
        title: e.title ?? "", gender: e.gender ?? "", name: e.name ?? "", email: e.email ?? "",
        personalEmail: e.personalEmail ?? "", mobileNumber: e.mobileNumber ?? "", dob: toDateInput(e.dob),
        bloodGroup: e.bloodGroup ?? "", nationality: e.nationality ?? "", maritalStatus: e.maritalStatus ?? "",
      };
    case "employment":
      return {
        designation: e.designation ?? "", department: idOf(e.department), location: e.location ?? "",
        currency: e.currency ?? "AED", status: e.status ?? "active", joiningDate: toDateInput(e.joiningDate),
        confirmationDate: toDateInput(e.confirmationDate), probationPeriodDays: e.probationPeriodDays ?? 0,
        noticePeriodDays: e.noticePeriodDays ?? 60,
        // Composite "kind:id" so a manager can be an Employee or a login User.
        reportingTo: idOf(e.reportingTo) ? `${e.reportingToKind ?? "Employee"}:${idOf(e.reportingTo)}` : "",
        oldCompanyExperience: e.oldCompanyExperience ?? "",
      };
    case "bank":
      return { bank: { bankAccountNumber: e.bank?.bankAccountNumber ?? "", ibanIfsc: e.bank?.ibanIfsc ?? "", bankName: e.bank?.bankName ?? "", nameInBank: e.bank?.nameInBank ?? "" } };
    case "education":
      return { education: e.education?.length ? e.education : [{ qualification: "", from: "", to: "", institute: "" }] };
    case "currentAddress":
      return { currentAddress: { address: e.currentAddress?.address ?? "", city: e.currentAddress?.city ?? "", state: e.currentAddress?.state ?? "", country: e.currentAddress?.country ?? "" } };
    case "permanentAddress":
      return { permanentAddress: { address: e.permanentAddress?.address ?? "", city: e.permanentAddress?.city ?? "", state: e.permanentAddress?.state ?? "", country: e.permanentAddress?.country ?? "" } };
    case "emergency":
      return { emergencyContacts: e.emergencyContacts?.length ? e.emergencyContacts : [{ name: "", relation: "", phoneNumber: "", email: "", address: "", city: "", state: "", country: "" }] };
    case "family":
      return { familyMembers: e.familyMembers?.length ? e.familyMembers.map((f) => ({ ...f, dob: toDateInput(f.dob) })) : [{ name: "", relation: "", dob: "", phone: "" }] };
    case "passport":
      return { passport: { passportNumber: e.passport?.passportNumber ?? "", country: e.passport?.country ?? "", issueDate: toDateInput(e.passport?.issueDate), expiryDate: toDateInput(e.passport?.expiryDate) } };
    case "visa":
      return { visa: { country: e.visa?.country ?? "", type: e.visa?.type ?? "", issueDate: toDateInput(e.visa?.issueDate), expiryDate: toDateInput(e.visa?.expiryDate) } };
    case "labourCard":
      return { labourCard: { cardNumber: e.labourCard?.cardNumber ?? "", issueDate: toDateInput(e.labourCard?.issueDate), expiryDate: toDateInput(e.labourCard?.expiryDate) } };
    case "emiratesId":
      return { emiratesId: { idNumber: e.emiratesId?.idNumber ?? "", issueDate: toDateInput(e.emiratesId?.issueDate), expiryDate: toDateInput(e.emiratesId?.expiryDate) } };
  }
}

/** Convert "" → undefined and drop empty enum selects so we don't send junk. */
function cleanPayload(v: FormValues): FormValues {
  const walk = (val: unknown): unknown => {
    if (Array.isArray(val)) return val.map(walk);
    if (val && typeof val === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(val)) out[k] = walk(x);
      return out;
    }
    return val === "" ? undefined : val;
  };
  return walk(v) as FormValues;
}

const field = "space-y-1.5";

export function EmployeeSectionDialog({
  open, onOpenChange, section, employee, selfService,
}: { open: boolean; onOpenChange: (o: boolean) => void; section: ProfileSection; employee: Employee; selfService?: boolean }) {
  const { mutate: updateEmployee, isPending: updatingEmployee } = useUpdateEmployee();
  const { mutate: updateMyProfile, isPending: updatingMyProfile } = useUpdateMyProfile();
  const isPending = selfService ? updatingMyProfile : updatingEmployee;
  // Employment/reporting-line pickers aren't shown in self-service mode, so skip fetching them.

  const { register, handleSubmit, control, reset } = useForm<FormValues>({ defaultValues: defaultsFor(section, employee) });

  useEffect(() => {
    if (open) reset(defaultsFor(section, employee));
  }, [open, section, employee, reset]);

  const onSubmit = (data: FormValues) => {
    const payload = cleanPayload(data);
    // Split the composite "kind:id" reporting-to value into ref + kind.
    if (section === "employment") {
      const raw = data.reportingTo as string | undefined;
      if (raw && raw.includes(":")) {
        const [kind, id] = raw.split(":");
        payload.reportingTo = id;
        payload.reportingToKind = kind;
      } else {
        payload.reportingTo = null;
        delete payload.reportingToKind;
      }
    }
    if (selfService) {
      updateMyProfile(payload, { onSuccess: () => onOpenChange(false) });
    } else {
      updateEmployee({ id: employee._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Edit · {SECTION_TITLES[section]}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          {section === "personal" && (
            <div className="grid grid-cols-2 gap-4">
              <div className={field}><Label>Title</Label>
                <SelectCtl control={control} name="title" placeholder="Select">
                  {(Object.keys(TITLE_LABELS) as Title[]).map((t) => <SelectItem key={t} value={t}>{TITLE_LABELS[t]}</SelectItem>)}
                </SelectCtl>
              </div>
              <div className={field}><Label>Full name</Label><Input {...register("name")} /></div>
              <div className={field}><Label>Gender</Label>
                <SelectCtl control={control} name="gender" placeholder="Select">
                  {(Object.keys(GENDER_LABELS) as Gender[]).map((g) => <SelectItem key={g} value={g}>{GENDER_LABELS[g]}</SelectItem>)}
                </SelectCtl>
              </div>
              <div className={field}><Label>Marital status</Label>
                <SelectCtl control={control} name="maritalStatus" placeholder="Select">
                  {(Object.keys(MARITAL_LABELS) as MaritalStatus[]).map((m) => <SelectItem key={m} value={m}>{MARITAL_LABELS[m]}</SelectItem>)}
                </SelectCtl>
              </div>
              <div className={field}><Label>Work email</Label><Input type="email" {...register("email")} /></div>
              <div className={field}><Label>Personal email</Label><Input type="email" {...register("personalEmail")} /></div>
              <div className={field}><Label>Mobile number</Label><Input {...register("mobileNumber")} /></div>
              <div className={field}><Label>Date of birth</Label><Input type="date" {...register("dob")} /></div>
              <div className={field}><Label>Blood group</Label>
                <SelectCtl control={control} name="bloodGroup" placeholder="Select">
                  {BLOOD_GROUPS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectCtl>
              </div>
              <div className={field}><Label>Nationality</Label><Input {...register("nationality")} /></div>
            </div>
          )}

          {section === "employment" && (
            <div className="grid grid-cols-2 gap-4">
              <div className={field}><Label>Designation</Label><Input {...register("designation")} /></div>
              <div className={field}><Label>Department</Label>
                <Controller control={control} name="department" render={({ field }) => (
                  <DepartmentSelect
                    value={field.value as string}
                    onChange={field.onChange}
                    placeholder="Select department"
                    allowClear
                  />
                )} />
              </div>
              <div className={field}><Label>Location</Label><Input placeholder="Dubai / India" {...register("location")} /></div>
              <div className={field}><Label>Currency</Label><Input className="uppercase" {...register("currency")} /></div>
              <div className={field}><Label>Status</Label>
                <SelectCtl control={control} name="status" placeholder="Select">
                  {(Object.keys(EMPLOYEE_STATUS_LABELS) as EmployeeStatus[]).map((s) => <SelectItem key={s} value={s}>{EMPLOYEE_STATUS_LABELS[s]}</SelectItem>)}
                </SelectCtl>
              </div>
              <div className={field}><Label>Reporting to</Label>
                <Controller control={control} name="reportingTo" render={({ field }) => (
                  <ManagerSelect
                    value={field.value as string}
                    onChange={field.onChange}
                    excludeEmployeeId={employee._id}
                    placeholder="Select manager"
                    allowClear
                  />
                )} />
              </div>
              <div className={field}><Label>Joining date</Label><Input type="date" {...register("joiningDate")} /></div>
              <div className={field}><Label>Confirmation date</Label><Input type="date" {...register("confirmationDate")} /></div>
              <div className={field}><Label>Probation period (days)</Label><Input type="number" min="0" {...register("probationPeriodDays")} /></div>
              <div className={field}><Label>Notice period (days)</Label><Input type="number" min="0" {...register("noticePeriodDays")} /></div>
              <div className={`${field} col-span-2`}><Label>Previous company experience</Label><Textarea rows={3} {...register("oldCompanyExperience")} /></div>
            </div>
          )}

          {section === "bank" && (
            <div className="grid grid-cols-2 gap-4">
              <div className={field}><Label>Name in bank</Label><Input {...register("bank.nameInBank")} /></div>
              <div className={field}><Label>Bank name</Label><Input {...register("bank.bankName")} /></div>
              <div className={field}><Label>Account number</Label><Input {...register("bank.bankAccountNumber")} /></div>
              <div className={field}><Label>IBAN / IFSC</Label><Input {...register("bank.ibanIfsc")} /></div>
            </div>
          )}

          {(section === "currentAddress" || section === "permanentAddress") && (
            <div className="grid grid-cols-2 gap-4">
              <div className={`${field} col-span-2`}><Label>Address</Label><Textarea rows={2} {...register(`${section}.address`)} /></div>
              <div className={field}><Label>City</Label><Input {...register(`${section}.city`)} /></div>
              <div className={field}><Label>State</Label><Input {...register(`${section}.state`)} /></div>
              <div className={field}><Label>Country</Label><Input {...register(`${section}.country`)} /></div>
            </div>
          )}

          {section === "education" && <EducationRows control={control} register={register} />}
          {section === "emergency" && <EmergencyRows control={control} register={register} />}
          {section === "family" && <FamilyRows control={control} register={register} />}

          {section === "passport" && (
            <div className="grid grid-cols-2 gap-4">
              <div className={field}><Label>Passport number</Label><Input {...register("passport.passportNumber")} /></div>
              <div className={field}><Label>Country</Label><Input {...register("passport.country")} /></div>
              <div className={field}><Label>Issue date</Label><Input type="date" {...register("passport.issueDate")} /></div>
              <div className={field}><Label>Expiry date</Label><Input type="date" {...register("passport.expiryDate")} /></div>
            </div>
          )}

          {section === "visa" && (
            <div className="grid grid-cols-2 gap-4">
              <div className={field}><Label>Country</Label><Input {...register("visa.country")} /></div>
              <div className={field}><Label>Type</Label>
                <SelectCtl control={control} name="visa.type" placeholder="Select type">
                  {VISA_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectCtl>
              </div>
              <div className={field}><Label>Issue date</Label><Input type="date" {...register("visa.issueDate")} /></div>
              <div className={field}><Label>Expiry date</Label><Input type="date" {...register("visa.expiryDate")} /></div>
            </div>
          )}

          {section === "labourCard" && (
            <div className="grid grid-cols-2 gap-4">
              <div className={field}><Label>Card number</Label><Input {...register("labourCard.cardNumber")} /></div>
              <div className={field}><Label>Issue date</Label><Input type="date" {...register("labourCard.issueDate")} /></div>
              <div className={field}><Label>Expiry date</Label><Input type="date" {...register("labourCard.expiryDate")} /></div>
            </div>
          )}

          {section === "emiratesId" && (
            <div className="grid grid-cols-2 gap-4">
              <div className={field}><Label>ID number</Label><Input {...register("emiratesId.idNumber")} /></div>
              <div className={field}><Label>Issue date</Label><Input type="date" {...register("emiratesId.issueDate")} /></div>
              <div className={field}><Label>Expiry date</Label><Input type="date" {...register("emiratesId.expiryDate")} /></div>
            </div>
          )}

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** Controller-wrapped Select that maps "" ↔ NONE sentinel. */
function SelectCtl({
  control, name, placeholder, children,
}: { control: Control<FormValues>; name: string; placeholder: string; children: React.ReactNode }) {
  return (
    <Controller control={control} name={name} render={({ field: f }) => (
      <Select value={(f.value as string) || NONE} onValueChange={(v) => f.onChange(v === NONE ? "" : v)}>
        <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>— None —</SelectItem>
          {children}
        </SelectContent>
      </Select>
    )} />
  );
}

function EducationRows({ control, register }: { control: Control<FormValues>; register: UseFormRegister<FormValues> }) {
  const fa = useFieldArray({ control, name: "education" as never });
  return (
    <div className="space-y-3">
      {fa.fields.map((f, i) => (
        <div key={f.id} className="rounded-xl border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Qualification {i + 1}</span>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => fa.remove(i)}><Trash2 className="h-4 w-4" /></Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className={`${field} col-span-2`}><Label>Qualification</Label><Input {...register(`education.${i}.qualification`)} /></div>
            <div className={field}><Label>From</Label><Input placeholder="2016" {...register(`education.${i}.from`)} /></div>
            <div className={field}><Label>To</Label><Input placeholder="2020" {...register(`education.${i}.to`)} /></div>
            <div className={`${field} col-span-2`}><Label>Institute</Label><Input {...register(`education.${i}.institute`)} /></div>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fa.append({ qualification: "", from: "", to: "", institute: "" } as never)}><Plus className="h-3.5 w-3.5" />Add qualification</Button>
    </div>
  );
}

function FamilyRows({ control, register }: { control: Control<FormValues>; register: UseFormRegister<FormValues> }) {
  const fa = useFieldArray({ control, name: "familyMembers" as never });
  return (
    <div className="space-y-3">
      {fa.fields.map((f, i) => (
        <div key={f.id} className="rounded-xl border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Member {i + 1}</span>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => fa.remove(i)}><Trash2 className="h-4 w-4" /></Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className={field}><Label>Name</Label><Input {...register(`familyMembers.${i}.name`)} /></div>
            <div className={field}><Label>Relation</Label><Input {...register(`familyMembers.${i}.relation`)} /></div>
            <div className={field}><Label>Date of birth</Label><Input type="date" {...register(`familyMembers.${i}.dob`)} /></div>
            <div className={field}><Label>Phone</Label><Input {...register(`familyMembers.${i}.phone`)} /></div>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fa.append({ name: "", relation: "", dob: "", phone: "" } as never)}><Plus className="h-3.5 w-3.5" />Add family member</Button>
    </div>
  );
}

function EmergencyRows({ control, register }: { control: Control<FormValues>; register: UseFormRegister<FormValues> }) {
  const fa = useFieldArray({ control, name: "emergencyContacts" as never });
  return (
    <div className="space-y-3">
      {fa.fields.map((f, i) => (
        <div key={f.id} className="rounded-xl border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Contact {i + 1}</span>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => fa.remove(i)}><Trash2 className="h-4 w-4" /></Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className={field}><Label>Name</Label><Input {...register(`emergencyContacts.${i}.name`)} /></div>
            <div className={field}><Label>Relation</Label><Input {...register(`emergencyContacts.${i}.relation`)} /></div>
            <div className={field}><Label>Phone number</Label><Input {...register(`emergencyContacts.${i}.phoneNumber`)} /></div>
            <div className={field}><Label>Email</Label><Input type="email" {...register(`emergencyContacts.${i}.email`)} /></div>
            <div className={`${field} col-span-2`}><Label>Address</Label><Input {...register(`emergencyContacts.${i}.address`)} /></div>
            <div className={field}><Label>City</Label><Input {...register(`emergencyContacts.${i}.city`)} /></div>
            <div className={field}><Label>State</Label><Input {...register(`emergencyContacts.${i}.state`)} /></div>
            <div className={`${field} col-span-2`}><Label>Country</Label><Input {...register(`emergencyContacts.${i}.country`)} /></div>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fa.append({ name: "", relation: "", phoneNumber: "", email: "", address: "", city: "", state: "", country: "" } as never)}><Plus className="h-3.5 w-3.5" />Add contact</Button>
    </div>
  );
}
