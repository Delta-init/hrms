import { Router } from "express";
import {
  createProcurement, getProcurements, getProcurementById, updateProcurement, deleteProcurement,
} from "../controllers/procurementController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

/**
 * Gated on `assets` rather than a module of its own.
 *
 * Procurement lives on the assets page and is read and written by the same
 * people, so a second module would mean granting six roles a permission on the
 * day it shipped to keep the page working as it already did. It gets its own
 * module when approval arrives and `approve` starts to mean something here
 * that it does not mean for an asset.
 */
const router = Router();
router.use(authenticate);

router.get("/", checkPermission("assets", "view"), getProcurements);
router.post("/", checkPermission("assets", "create"), createProcurement);
router.get("/:id", checkPermission("assets", "view"), getProcurementById);
router.put("/:id", checkPermission("assets", "edit"), updateProcurement);
router.delete("/:id", checkPermission("assets", "delete"), deleteProcurement);

export default router;
