import { Router } from "express";
import {
  deleteKiosk,
  kioskChallenge,
  kioskPunch,
  kioskSession,
  listKiosks,
  registerKiosk,
  rotateKioskToken,
  setKioskActive,
} from "../controllers/kioskController.js";
import { authenticate } from "../middleware/auth.js";
import { authenticateKiosk } from "../middleware/kioskAuth.js";
import { checkPermission } from "../middleware/permissions.js";
import { kioskPunchLimiter } from "../middleware/rateLimit.js";

const router = Router();

// ─── Device side ─────────────────────────────────────────────────────────────
// Authenticated by the device token, not a user session — there is nobody
// signed in at a kiosk. Registered before the `authenticate` guard below so the
// tablet never needs a login of its own.
router.get("/session", authenticateKiosk, kioskSession);
router.post("/challenge", kioskPunchLimiter, authenticateKiosk, kioskChallenge);
router.post("/punch", kioskPunchLimiter, authenticateKiosk, kioskPunch);

// ─── Management side ─────────────────────────────────────────────────────────
router.use(authenticate);

router.get("/", checkPermission("attendance", "view"), listKiosks);
router.post("/", checkPermission("attendance", "edit"), registerKiosk);
router.post("/:id/rotate-token", checkPermission("attendance", "edit"), rotateKioskToken);
router.patch("/:id/active", checkPermission("attendance", "edit"), setKioskActive);
router.delete("/:id", checkPermission("attendance", "delete"), deleteKiosk);

export default router;
