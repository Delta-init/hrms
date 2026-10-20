import { Employee } from "../models/Employee.js";

/*
 * Where somebody works, for another system (the user, 2026-10-19: "only office employees get a pod — check from
 * the HRMS, and whether the instructor is correct"). The LMS names its mentors (email, and the name it has) and
 * hears back, for each, the HRMS employee it is — matched by work email, else by the exact name when exactly one
 * employee has it — with their work mode (office / wfh), location, status and designation. Read only.
 */

export interface StaffAsk { email: string; name?: string }
export interface StaffWorkMode {
  /** As asked. */
  email: string;
  /** How the employee was found: their email, only their name (the LMS's email differs), or not at all. */
  matchedBy: "email" | "name" | null;
  hrmsEmail: string | null;
  hrmsName: string | null;
  workMode: "office" | "wfh" | null;
  location: "india" | "dubai" | null;
  status: string | null;
  designation: string | null;
}

const LEFT = new Set(["terminated", "resigned"]);
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Row = { _id: unknown; name?: string; email?: string; workMode?: string; location?: string; status?: string; designation?: string };

/** Of several records for one person, the one still working here. */
const pick = (rows: Row[]): Row | undefined => rows.find((r) => !LEFT.has(String(r.status))) ?? rows[0];

export async function staffWorkModes(people: StaffAsk[], organizationId?: string): Promise<StaffWorkMode[]> {
  const org = organizationId ? { organization: organizationId } : {};
  const emails = [...new Set(people.map((p) => norm(p.email)).filter(Boolean))];
  const byEmailRows = emails.length
    ? await Employee.find({ ...org, email: { $in: emails } }).select("name email workMode location status designation").lean<Row[]>()
    : [];
  const byEmail = new Map<string, Row[]>();
  for (const r of byEmailRows) byEmail.set(norm(r.email), [...(byEmail.get(norm(r.email)) ?? []), r]);

  // Only those not found by email are looked for by name — an exact name, case and spacing aside.
  const names = [...new Set(people.filter((p) => !byEmail.has(norm(p.email)) && norm(p.name)).map((p) => norm(p.name)))];
  const byNameRows = names.length
    ? await Employee.find({ ...org, $or: names.map((n) => ({ name: new RegExp(`^\\s*${escape(n).replace(/ /g, "\\s+")}\\s*$`, "i") })) })
        .select("name email workMode location status designation").lean<Row[]>()
    : [];
  const byName = new Map<string, Row[]>();
  for (const r of byNameRows) byName.set(norm(r.name), [...(byName.get(norm(r.name)) ?? []), r]);

  return people.map((p) => {
    const email = norm(p.email);
    let found = pick(byEmail.get(email) ?? []);
    let matchedBy: StaffWorkMode["matchedBy"] = found ? "email" : null;
    if (!found && norm(p.name)) {
      // Two people with that name still here: not a match — it can't say which.
      const same = (byName.get(norm(p.name)) ?? []).filter((r) => !LEFT.has(String(r.status)));
      if (same.length === 1) { found = same[0]; matchedBy = "name"; }
    }
    return {
      email: p.email,
      matchedBy,
      hrmsEmail: found?.email ?? null,
      hrmsName: found?.name ?? null,
      workMode: found ? (found.workMode === "wfh" ? "wfh" : "office") : null,
      location: found?.location === "dubai" || found?.location === "india" ? found.location : null,
      status: found?.status ?? null,
      designation: found?.designation ?? null,
    };
  });
}
