import { z } from "zod";

export const registerKioskSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  location: z.string().trim().max(120).optional(),
});

export const kioskPunchSchema = z.object({
  // A few frames of the same moment. The recognition service scores each and
  // keeps the best, which makes a blink or a half-turn cost nothing.
  images: z
    .array(z.string().min(100, "Frame looks empty"))
    .min(1, "At least one frame is required")
    .max(5, "Too many frames"),
});

export type RegisterKioskInput = z.infer<typeof registerKioskSchema>;
