import { z } from "zod";

export const registerKioskSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  location: z.string().trim().max(120).optional(),
});

export const kioskPunchSchema = z.object({
  // One frame per prompt, plus room for a spare. The recognition service scores
  // each and keeps the best, so a blink or a half-turn costs nothing.
  images: z
    .array(z.string().min(100, "Frame looks empty"))
    .min(1, "At least one frame is required")
    .max(8, "Too many frames"),
  // Required when liveness is on; the service rejects the punch without it.
  challengeId: z.string().optional(),
});

export type RegisterKioskInput = z.infer<typeof registerKioskSchema>;
