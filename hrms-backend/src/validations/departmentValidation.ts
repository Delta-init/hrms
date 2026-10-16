import { z } from "zod";

const personKind = z.enum(["Employee", "User"]);
const memberSchema = z.object({ kind: personKind, ref: z.string().min(1) });

export const createDepartmentSchema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  code: z.string().max(12).optional(),
  description: z.string().max(300).optional(),
  leader: z.string().optional().nullable(),
  leaderKind: personKind.optional(),
  coLeaders: z.array(memberSchema).default([]),
  members: z.array(memberSchema).default([]),
  webOnlyForRemote: z.boolean().optional(),
  status: z.enum(["active", "inactive"]).default("active"),
});

export const updateDepartmentSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  code: z.string().max(12).optional().nullable(),
  description: z.string().max(300).optional().nullable(),
  leader: z.string().optional().nullable(),
  leaderKind: personKind.optional(),
  coLeaders: z.array(memberSchema).optional(),
  members: z.array(memberSchema).optional(),
  /**
   * People the editor was shown on this department and took off it.
   *
   * Not stored. It exists so that removing somebody who is in the department by
   * their own record but was never on the roster still takes effect, without
   * the server having to guess that from a list that is merely shorter than the
   * truth. Absent means nobody was removed.
   */
  removedMembers: z.array(memberSchema).optional(),
  webOnlyForRemote: z.boolean().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
