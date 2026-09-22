import { Router } from "express";
import {
  createProcurement, getProcurements, getProcurementById, updateProcurement, deleteProcurement,
  reviewProcurement, resubmitProcurement,
} from "../controllers/procurementController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission, checkPermissionOrDepartmentHead } from "../middleware/permissions.js";

/**
 * Its own module, not `assets`.
 *
 * Approving a purchase is a different authority from issuing a laptop: the
 * people who hand out equipment are not necessarily the people who may commit
 * the company to spending, and finance sees only this. `approve` here means
 * "send it to finance", which has no equivalent on an asset at all.
 *
 * Raising one is open to department heads as well as to whoever holds the
 * permission, because heading a team is where the need for a thing is noticed
 * and that authority comes from the org chart rather than from a role. Sending
 * it on to finance is not: that stays with HR, which is what `approve` gates.
 */
const router = Router();
router.use(authenticate);

router.get("/", checkPermission("procurement", "view"), getProcurements);
router.post("/", checkPermissionOrDepartmentHead("procurement", "create"), createProcurement);
router.get("/:id", checkPermission("procurement", "view"), getProcurementById);
router.put("/:id", checkPermissionOrDepartmentHead("procurement", "edit"), updateProcurement);
// HR's decision, and the way back for a request that was refused.
router.patch("/:id/review", checkPermission("procurement", "approve"), reviewProcurement);
router.patch("/:id/resubmit", checkPermissionOrDepartmentHead("procurement", "edit"), resubmitProcurement);
router.delete("/:id", checkPermission("procurement", "delete"), deleteProcurement);

export default router;
