import { Employee } from "../models/Employee.js";
import { Department } from "../models/Department.js";
import { Asset } from "../models/Asset.js";
import { Announcement } from "../models/Announcement.js";
import { HelpdeskTicket } from "../models/HelpdeskTicket.js";
import { scoped } from "../utils/orgContext.js";
import { hasPermission } from "../middleware/permissions.js";
import { HRMS_MODULES, type AuthenticatedRequest, type HrmsModule } from "../types/index.js";

/**
 * One box that searches the data, not just the menu.
 *
 * A menu search can only find pages somebody already knows the name of. What
 * people actually type is a person's name, an asset tag, half a ticket
 * subject — the thing they are looking for rather than the page it lives on.
 * This answers those, and the client puts navigation results alongside.
 *
 * Every source states its own gate rather than the endpoint holding one
 * permission for all of them. A single gate would have to be the most
 * permissive of the sources to be useful, and would then leak the strictest —
 * an ordinary employee finding an asset register through the search box that
 * the assets page correctly refuses them.
 *
 * Two sources are open to everyone, and deliberately: the org chart already is,
 * and it carries the same names, titles and departments. Email is not part of
 * that, so it is added only for somebody who could read it on the employees
 * page anyway.
 */

export interface SearchHit {
  id: string;
  /** Which source it came from, for grouping and the icon. */
  group: string;
  title: string;
  subtitle: string;
  href: string;
}

type Role = NonNullable<AuthenticatedRequest["user"]>["role"];

/**
 * A case-insensitive contains, with the user's own text neutralised.
 *
 * Regex metacharacters in a search box are a bug waiting to happen: an
 * unbalanced bracket throws, and `.*` on a large collection is a way to make
 * the database do a great deal of work on request.
 */
const contains = (q: string) => new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

/** Per source, so one crowded collection cannot fill the whole panel. */
const PER_SOURCE = 5;

interface Source {
  group: string;
  /** Null where everybody may search it. */
  permission: HrmsModule | null;
  run: (rx: RegExp, role: Role) => Promise<SearchHit[]>;
}

const SOURCES: Source[] = [
  {
    group: "People",
    // Open, like the org chart, and returning the same fields it does.
    permission: null,
    run: async (rx, role) => {
      const canSeeContact = hasPermission(role, "employees", "view");
      const rows = await Employee.find(
        scoped({
          status: { $ne: "terminated" },
          $or: [
            { name: rx },
            { employeeCode: rx },
            { designation: rx },
            // Only searchable by somebody who is allowed to see it, or the box
            // becomes a way to confirm an address without being shown it.
            ...(canSeeContact ? [{ email: rx }] : []),
          ],
        })
      )
        .select("name employeeCode designation department email")
        .populate("department", "name")
        .limit(PER_SOURCE)
        .lean();
      return rows.map((e) => ({
        id: String(e._id),
        group: "People",
        title: String(e.name ?? "Unknown"),
        subtitle: [
          e.employeeCode,
          e.designation,
          (e.department as { name?: string } | null)?.name,
          canSeeContact ? e.email : null,
        ]
          .filter(Boolean)
          .join(" · "),
        // Somebody without the employees permission is sent to the chart, which
        // is the page that will actually open for them.
        href: canSeeContact ? `/employees/${String(e._id)}` : "/org-chart",
      }));
    },
  },
  {
    group: "Departments",
    permission: null,
    run: async (rx) => {
      const rows = await Department.find(scoped({ $or: [{ name: rx }, { code: rx }] }))
        .select("name code members")
        .limit(PER_SOURCE)
        .lean();
      return rows.map((d) => ({
        id: String(d._id),
        group: "Departments",
        title: String(d.name ?? ""),
        subtitle: [d.code, `${d.members?.length ?? 0} members`].filter(Boolean).join(" · "),
        href: `/departments/${String(d._id)}`,
      }));
    },
  },
  {
    group: "Assets",
    permission: "assets",
    run: async (rx) => {
      const rows = await Asset.find(
        scoped({ $or: [{ name: rx }, { assetTag: rx }, { serialNumber: rx }, { category: rx }] })
      )
        .select("name assetTag category status")
        .limit(PER_SOURCE)
        .lean();
      return rows.map((a) => ({
        id: String(a._id),
        group: "Assets",
        title: String(a.name ?? ""),
        subtitle: [a.assetTag, a.category, a.status].filter(Boolean).join(" · "),
        href: "/assets",
      }));
    },
  },
  {
    group: "Announcements",
    // Broadcast by definition — everyone they are addressed to may read them.
    permission: null,
    run: async (rx) => {
      const rows = await Announcement.find(scoped({ $or: [{ title: rx }, { body: rx }] }))
        .select("title createdAt")
        .sort({ createdAt: -1 })
        .limit(PER_SOURCE)
        .lean();
      return rows.map((a) => ({
        id: String(a._id),
        group: "Announcements",
        title: String(a.title ?? ""),
        subtitle: a.createdAt
          ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(a.createdAt as Date))
          : "",
        href: "/announcements",
      }));
    },
  },
  {
    group: "Helpdesk",
    permission: "helpdesk",
    run: async (rx) => {
      const rows = await HelpdeskTicket.find(scoped({ subject: rx }))
        .select("subject status category")
        .sort({ createdAt: -1 })
        .limit(PER_SOURCE)
        .lean();
      return rows.map((t) => ({
        id: String(t._id),
        group: "Helpdesk",
        title: String(t.subject ?? ""),
        subtitle: [t.category, t.status].filter(Boolean).join(" · "),
        href: "/helpdesk",
      }));
    },
  },
];

/**
 * A tablet by the door is not a person and has nothing to look up.
 *
 * The same test the client makes, repeated here because the client's copy only
 * governs whether the box is drawn — and a search endpoint that answers anyone
 * who asks it directly is not protected by a hidden button. The staff directory
 * is exactly what a device left unattended in a public room should not offer.
 *
 * Written to fail closed: a role granting nothing at all is treated as a kiosk
 * rather than as an unrestricted one.
 */
function isKioskOnly(role: Role): boolean {
  if (!role) return true;
  if (role.isSystemRole) return false;
  const perms = (role.permissions ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const granted = HRMS_MODULES.filter((mod) => {
    const actions = perms[mod];
    return !!actions && Object.values(actions).some(Boolean);
  });
  return granted.length <= 1 && (granted.length === 0 || granted[0] === "kiosk");
}

/**
 * Search everything this person is allowed to search.
 *
 * Sources run in parallel and each failure is contained: one collection with a
 * bad index must not turn the whole search box into an error, and a partial
 * answer is far more useful than none.
 */
export async function globalSearch(query: string, role: Role): Promise<SearchHit[]> {
  const q = query.trim();
  // Two characters is where a contains-search stops being a search and starts
  // being a list of everybody whose name has an "a" in it.
  if (q.length < 2) return [];
  if (isKioskOnly(role)) return [];
  const rx = contains(q);

  const allowed = SOURCES.filter((s) => s.permission === null || hasPermission(role, s.permission, "view"));
  const results = await Promise.all(
    allowed.map(async (s) => {
      try {
        return await s.run(rx, role);
      } catch (err) {
        console.error(`🔍 search source "${s.group}" failed:`, err instanceof Error ? err.message : err);
        return [];
      }
    })
  );
  return results.flat();
}
