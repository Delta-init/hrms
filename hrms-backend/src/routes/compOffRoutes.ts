import { Router } from "express";
import {
  grantCompOff, getCompOffCredits, revokeCompOffCredit,
  getCompOffSuggestions, getMyCompOffBalance, getMyCompOffCredits, getCompOffBalanceFor,
  requestCompOff, approveCompOff, approveManyCompOff, rejectCompOff,
} from "../controllers/compOffController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Self-service — own balance and own credit history, no module permission
// required. Distinct from /credits below, which lists everyone's.
router.get("/mine", getMyCompOffBalance);
router.get("/mine/credits", getMyCompOffCredits);
// Asking for a day back — pending until HR approves it below.
router.post("/mine/requests", requestCompOff);

// Everything else surfaces attendance/comp-off data across the org, so it's
// gated on leave.approve (manager/HR) rather than the broader leave.view.
router.get("/suggestions", checkPermission("leave", "approve"), getCompOffSuggestions);
router.get("/credits", checkPermission("leave", "approve"), getCompOffCredits);
router.post("/credits", checkPermission("leave", "approve"), grantCompOff);
router.post("/credits/approve", checkPermission("leave", "approve"), approveManyCompOff);
router.post("/credits/:id/approve", checkPermission("leave", "approve"), approveCompOff);
router.post("/credits/:id/reject", checkPermission("leave", "approve"), rejectCompOff);
router.delete("/credits/:id", checkPermission("leave", "approve"), revokeCompOffCredit);
router.get("/:userId", checkPermission("leave", "approve"), getCompOffBalanceFor);

export default router;
