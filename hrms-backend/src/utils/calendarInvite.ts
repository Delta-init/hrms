/**
 * Calendar invites, as an `.ics` part on the email.
 *
 * Deliberately not a calendar integration. Outlook and Google both understand
 * an iCalendar attachment and will offer to add it, which covers the actual
 * need — the interview appears in the panel's calendar — without OAuth, token
 * refresh, or asking an organization to trust this app with their mailbox.
 *
 * What it cannot do is read free/busy, so conflicts are checked against
 * interviews this system knows about and nothing else.
 */

export interface CalendarEvent {
  /** Stable across updates: the same UID re-sent is an edit, not a new event. */
  uid: string;
  /** Bumped on every re-send, or clients keep showing the first version. */
  sequence: number;
  start: Date;
  durationMinutes: number;
  summary: string;
  description?: string;
  location?: string;
  organizer: { name: string; email: string };
  attendees: Array<{ name?: string; email: string }>;
  cancelled?: boolean;
}

/** UTC, no punctuation — the only form every client agrees on. */
const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/**
 * Escapes the characters iCalendar treats as structure, then folds.
 *
 * RFC 5545 caps a line at 75 **octets** — not characters — and folds the rest
 * onto continuation lines beginning with a space. The distinction matters as
 * soon as a line contains an em-dash or a mid-dot, which these do: measuring in
 * characters lets a line run past the limit, and slicing by them can cut a
 * multi-byte character in half. Outlook drops a property it cannot parse, which
 * loses the meeting link exactly when it matters.
 */
function line(name: string, value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

  const out: string[] = [];
  let current = "";
  let bytes = 0;
  // Iterated by code point, so a surrogate pair is never split down the middle.
  for (const ch of `${name}:${escaped}`) {
    const size = Buffer.byteLength(ch);
    // A continuation line spends one of its 75 octets on the leading space.
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  if (current) out.push(current);

  return out.map((l, i) => (i === 0 ? l : ` ${l}`)).join("\r\n");
}

/** An `.ics` document for one event. */
export function buildInvite(e: CalendarEvent): string {
  const end = new Date(e.start.getTime() + e.durationMinutes * 60_000);
  const rows = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Delta HRMS//Hiring//EN",
    // REQUEST is an invitation; CANCEL withdraws one already sent.
    `METHOD:${e.cancelled ? "CANCEL" : "REQUEST"}`,
    "BEGIN:VEVENT",
    line("UID", e.uid),
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(end)}`,
    line("SUMMARY", e.summary),
    ...(e.description ? [line("DESCRIPTION", e.description)] : []),
    ...(e.location ? [line("LOCATION", e.location)] : []),
    line("ORGANIZER;CN=" + e.organizer.name, `mailto:${e.organizer.email}`),
    ...e.attendees.map((a) =>
      line(`ATTENDEE;CN=${a.name ?? a.email};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE`, `mailto:${a.email}`)
    ),
    `STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  // CRLF throughout: some clients reject an .ics with bare newlines.
  return rows.join("\r\n") + "\r\n";
}

/** The attachment shape `sendMail` expects. */
export function inviteAttachment(e: CalendarEvent) {
  return {
    filename: "invite.ics",
    content: buildInvite(e),
    contentType: `text/calendar; charset=utf-8; method=${e.cancelled ? "CANCEL" : "REQUEST"}`,
  };
}
