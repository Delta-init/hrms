import type { LetterCategory } from "@/types";

/**
 * Starting points for the letters every company writes.
 *
 * Presets rather than seeded rows. Seeding would put a copy of this text in
 * every organisation's database the moment it was created, where it would go
 * stale, get edited into something different, and still count as "the template
 * we shipped" — and a new organisation created afterwards would get nothing.
 * These stay in code, and become a real template only when somebody picks one,
 * reads it, and saves it. What they save is then theirs.
 *
 * Every one is a draft, not a legal document. The wording is deliberately plain
 * and the terms that vary by company — notice period, probation length, working
 * hours — are left as bracketed blanks rather than invented, so nobody issues a
 * letter promising something the company never agreed to.
 */

export interface LetterPreset {
  key: string;
  name: string;
  category: LetterCategory;
  /** One line on when this letter is the right one to send. */
  when: string;
  subject: string;
  body: string;
}

const SIGN_OFF = `Yours sincerely,

For {{organization.name}}


_______________________
Authorised Signatory
Human Resources`;

export const LETTER_PRESETS: LetterPreset[] = [
  {
    key: "offer",
    name: "Offer Letter",
    category: "offer",
    when: "Offering the role, before they accept.",
    subject: "Offer of Employment — {{employee.designation}}",
    body: `{{date.today}}

Dear {{employee.name}},

We are pleased to offer you the position of {{employee.designation}} at {{organization.name}}.

The principal terms of this offer are:

Position: {{employee.designation}}
Department: {{employee.department}}
Location: {{employee.location}}
Employment type: {{employee.employmentType}}
Expected start date: {{employee.joiningDate}}
Gross salary: {{employee.salary}} per month
Reporting to: {{employee.reportingTo}}
Probation: {{employee.probationDays}} days from your date of joining

This offer is subject to satisfactory reference checks and to your producing the documents we have requested. Your detailed terms of employment will be set out in your appointment letter, which you will receive on joining.

Please confirm your acceptance by signing and returning a copy of this letter by [date]. This offer lapses if we have not heard from you by then.

We are looking forward to working with you.

${SIGN_OFF}


I accept the offer set out above.


_______________________          _______________
{{employee.name}}                 Date`,
  },
  {
    key: "appointment",
    name: "Appointment Letter",
    category: "appointment",
    when: "On joining — the terms they are actually employed under.",
    subject: "Letter of Appointment — {{employee.name}}",
    body: `{{date.today}}

Dear {{employee.name}},

Further to your acceptance of our offer, we are pleased to confirm your appointment at {{organization.name}} on the following terms.

Employee code: {{employee.employeeCode}}
Position: {{employee.designation}}
Department: {{employee.department}}
Date of joining: {{employee.joiningDate}}
Location: {{employee.location}}
Reporting to: {{employee.reportingTo}}
Gross salary: {{employee.salary}} per month

1. Probation. You will be on probation for {{employee.probationDays}} days from your date of joining. Your appointment is confirmed in writing at the end of that period, and the company may extend it.

2. Hours and place of work. Your normal working hours are [hours], and you may be required to work at any of the company's locations.

3. Notice. After confirmation, either party may end this employment by giving [notice period] written notice, or salary in lieu.

4. Confidentiality. You will not, during your employment or afterwards, disclose any confidential information belonging to the company or its clients.

5. Company policy. Your employment is governed by the company's policies as amended from time to time.

Please sign and return the enclosed copy in acknowledgement.

${SIGN_OFF}`,
  },
  {
    key: "confirmation",
    name: "Confirmation Letter",
    category: "confirmation",
    when: "Probation passed — they are now a permanent employee.",
    subject: "Confirmation of Employment — {{employee.name}}",
    body: `{{date.today}}

Dear {{employee.name}},

We are pleased to inform you that, following a review of your performance during your probation, your services with {{organization.name}} are confirmed with effect from {{employee.confirmationDate}}.

You will continue in the position of {{employee.designation}} in the {{employee.department}} department, reporting to {{employee.reportingTo}}. All other terms of your appointment remain unchanged, save that the notice period applicable to a confirmed employee now applies.

Thank you for your contribution so far. We look forward to your continued association with us.

${SIGN_OFF}`,
  },
  {
    key: "experience",
    name: "Experience Certificate",
    category: "experience",
    when: "After they leave — what they did and for how long.",
    subject: "Experience Certificate — {{employee.name}}",
    body: `{{date.today}}

TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{employee.name}} (Employee Code: {{employee.employeeCode}}) was employed with {{organization.name}} from {{employee.joiningDate}} to {{employee.lastWorkingDay}}.

At the time of leaving, {{employee.name}} held the position of {{employee.designation}} in the {{employee.department}} department.

We found them to be sincere and hardworking, and their conduct during their tenure was satisfactory.

We wish them every success in their future endeavours.

${SIGN_OFF}`,
  },
  {
    key: "relieving",
    name: "Relieving Letter",
    category: "relieving",
    when: "Formally releasing them once handover and clearance are done.",
    subject: "Relieving Letter — {{employee.name}}",
    body: `{{date.today}}

Dear {{employee.name}},

This is with reference to your resignation dated {{employee.resignationDate}}.

We confirm that you have been relieved from your duties as {{employee.designation}} at {{organization.name}} with effect from the close of business on {{employee.lastWorkingDay}}.

Your handover is complete and the company confirms that no dues remain outstanding against you, subject to the final settlement being processed in the normal course.

We thank you for your service and wish you the very best.

${SIGN_OFF}`,
  },
  {
    key: "warning",
    name: "Warning Letter",
    category: "warning",
    when: "A documented warning, on the record.",
    subject: "Warning Letter — {{employee.name}}",
    body: `{{date.today}}

Dear {{employee.name}},

This letter is a formal warning regarding [state the conduct or performance issue, with the dates on which it occurred].

This was discussed with you on [date]. Despite that discussion, the matter has not been addressed, and it falls short of the standard expected of you under the company's policies.

You are required to correct this with immediate effect. Failure to show a sustained improvement by [review date] may result in further disciplinary action, up to and including termination of employment.

You may respond to this letter in writing within [number] days if you wish your account to be placed on record.

A copy of this letter will be held in your personnel file.

${SIGN_OFF}


Acknowledged as received.


_______________________          _______________
{{employee.name}}                 Date`,
  },
  {
    key: "salary-certificate",
    name: "Salary Certificate",
    category: "other",
    when: "For a bank, landlord or embassy — proof of employment and pay.",
    subject: "Salary Certificate — {{employee.name}}",
    body: `{{date.today}}

TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{employee.name}} (Employee Code: {{employee.employeeCode}}) has been employed with {{organization.name}} since {{employee.joiningDate}} and currently holds the position of {{employee.designation}} in the {{employee.department}} department.

Their present gross salary is {{employee.salary}} per month.

This certificate is issued at the request of the employee for [purpose] and carries no financial obligation on the part of the company.

${SIGN_OFF}`,
  },
  {
    key: "noc",
    name: "No Objection Certificate",
    category: "other",
    when: "Visa, travel or a second job — the company has no objection.",
    subject: "No Objection Certificate — {{employee.name}}",
    body: `{{date.today}}

TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{employee.name}} (Employee Code: {{employee.employeeCode}}) is employed with {{organization.name}} as {{employee.designation}} since {{employee.joiningDate}}.

{{organization.name}} has no objection to [state what is being permitted — for example, their application for a visit visa to [country] from [date] to [date]].

Their position with the company remains unaffected, and they are expected to resume their duties on [date].

This certificate is issued at the request of the employee.

${SIGN_OFF}`,
  },
  {
    key: "salary-revision",
    name: "Salary Revision Letter",
    category: "other",
    when: "A raise or a change in pay, in writing.",
    subject: "Revision in Compensation — {{employee.name}}",
    body: `{{date.today}}

Dear {{employee.name}},

Following the annual review of your performance, we are pleased to inform you that your compensation has been revised with effect from [effective date].

Your revised gross salary is {{employee.salary}} per month.

Your position of {{employee.designation}} in the {{employee.department}} department and all other terms of your employment remain unchanged.

This revision recognises your contribution over the past year, and we thank you for it.

${SIGN_OFF}`,
  },
  {
    key: "internship-completion",
    name: "Internship Completion Certificate",
    category: "other",
    when: "An intern finishing their term.",
    subject: "Internship Completion Certificate — {{employee.name}}",
    body: `{{date.today}}

TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{employee.name}} successfully completed an internship with {{organization.name}} from {{employee.joiningDate}} to {{employee.lastWorkingDay}} in the {{employee.department}} department.

During the internship they worked on [brief description of the work or project] and were found to be diligent, willing to learn, and professional in their conduct.

We wish them every success in their studies and career.

${SIGN_OFF}`,
  },
];

export const presetByKey = (key: string): LetterPreset | undefined =>
  LETTER_PRESETS.find((p) => p.key === key);
