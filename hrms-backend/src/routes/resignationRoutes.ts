import { Router } from "express";
import {
  createResignation, getResignations, getResignationById, updateResignation,
  reviewResignation, withdrawResignation, relieveResignation, deleteResignation, runRelieveDue,
} from "../controllers/resignationController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

router.get("/", checkPermission("resignations", "view"), getResignations);
router.post("/", checkPermission("resignations", "create"), createResignation);
// Manually run the auto-relieve pass (must precede "/:id").
router.post("/relieve-due", checkPermission("resignations", "approve"), runRelieveDue);
router.get("/:id", checkPermission("resignations", "view"), getResignationById);
router.put("/:id", checkPermission("resignations", "edit"), updateResignation);
router.patch("/:id/review", checkPermission("resignations", "approve"), reviewResignation);
router.patch("/:id/withdraw", checkPermission("resignations", "edit"), withdrawResignation);
router.patch("/:id/relieve", checkPermission("resignations", "approve"), relieveResignation);
router.delete("/:id", checkPermission("resignations", "delete"), deleteResignation);

export default router;
