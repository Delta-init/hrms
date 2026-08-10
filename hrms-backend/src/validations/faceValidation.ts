import { z } from "zod";

export const enrollFaceSchema = z.object({
  // Base64 frames (raw or data: URL). The face service does the real checking —
  // this only keeps obvious junk from crossing a process boundary.
  images: z
    .array(z.string().min(100, "Capture looks empty"))
    .min(1, "At least one capture is required")
    .max(10, "Too many captures"),
  // Enrollment is refused without this. Biometric data needs consent that was
  // actually given, so it is a required field rather than a default.
  consentAcknowledged: z.boolean(),
});

export type EnrollFaceInput = z.infer<typeof enrollFaceSchema>;
