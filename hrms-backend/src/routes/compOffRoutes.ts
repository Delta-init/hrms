import { Router } from "express";
import {
  grantCompOff, getCompOffCredits, revokeCompOffCredit,
  getCompOffSuggestions, getMyCompOffBalance, getCompOffBalanceFor,
} from "../controllers/compOffController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Self-service — own balance only, no module permission required.
router.get("/mine", getMyCompOffBalance);

// Everything else surfaces attendance/comp-off data across the org, so it's
// gated on leave.approve (manager/HR) rather than the broader leave.view.
router.get("/suggestions", checkPermission("leave", "approve"), getCompOffSuggestions);
router.get("/credits", checkPermission("leave", "approve"), getCompOffCredits);
router.post("/credits", checkPermission("leave", "approve"), grantCompOff);
router.delete("/credits/:id", checkPermission("leave", "approve"), revokeCompOffCredit);
router.get("/:userId", checkPermission("leave", "approve"), getCompOffBalanceFor);

export default router;
