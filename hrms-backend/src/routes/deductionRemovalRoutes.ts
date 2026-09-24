import { Router } from "express";
import {
  getEligible, createRequest, getMyRequests, getRequests, reviewRequest, withdrawRequest,
} from "../controllers/deductionRemovalController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

/**
 * Raising one is self-service, exactly like office keeping and leave — the
 * person it would deduct from is the one asking, and there is no approval to
 * pass before saying so, only afterwards. `approve` gates the panel that
 * decides it.
 */
const router = Router();
router.use(authenticate);

// Self-service.
router.get("/eligible", getEligible);
router.post("/", createRequest);
router.get("/mine", getMyRequests);
router.patch("/:id/withdraw", withdrawRequest);

// The panel.
router.get("/", checkPermission("deductionRemovals", "approve"), getRequests);
router.patch("/:id/review", checkPermission("deductionRemovals", "approve"), reviewRequest);

export default router;
