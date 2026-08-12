/** Merge tokens a letter template body/subject can reference — kept in sync
 *  with the resolution logic in hrms-backend/src/services/letterService.ts. */
export const MERGE_TOKENS: { token: string; label: string }[] = [
  { token: "{{employee.name}}", label: "Employee name" },
  { token: "{{employee.employeeCode}}", label: "Employee code" },
  { token: "{{employee.designation}}", label: "Designation" },
  { token: "{{employee.department}}", label: "Department" },
  { token: "{{employee.email}}", label: "Work email" },
  { token: "{{employee.phone}}", label: "Phone" },
  { token: "{{employee.joiningDate}}", label: "Joining date" },
  { token: "{{employee.salary}}", label: "Salary" },
  { token: "{{employee.location}}", label: "Location" },
  { token: "{{employee.reportingTo}}", label: "Reporting manager" },
  { token: "{{employee.employmentType}}", label: "Employment type" },
  { token: "{{employee.probationDays}}", label: "Probation (days)" },
  { token: "{{employee.confirmationDate}}", label: "Confirmation date" },
  // Both read the employee's decided resignation, so they are blank for anyone
  // still employed — which is the only time a relieving letter is wrong anyway.
  { token: "{{employee.lastWorkingDay}}", label: "Last working day" },
  { token: "{{employee.resignationDate}}", label: "Resignation date" },
  { token: "{{organization.name}}", label: "Company name" },
  { token: "{{organization.code}}", label: "Company code" },
  { token: "{{date.today}}", label: "Today's date" },
];
