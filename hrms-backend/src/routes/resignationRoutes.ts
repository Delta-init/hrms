import { Router } from "express";
import {
  createResignation, getResignations, getResignationById, updateResignation,
  reviewResignation, withdrawResignation, relieveResignation, deleteResignation, runRelieveDue,
  setExitDetails, previewSettlement, saveSettlement, finaliseSettlement,
  startClearance, setClearance, updateClearanceItem, saveExitInterview,
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
router.patch("/:id/exit", checkPermission("resignations", "edit"), setExitDetails);
// Full & final settlement.
router.post("/:id/settlement/preview", checkPermission("resignations", "view"), previewSettlement);
router.put("/:id/settlement", checkPermission("resignations", "edit"), saveSettlement);
router.post("/:id/settlement/settle", checkPermission("resignations", "approve"), finaliseSettlement);
// Exit clearance & interview.
router.post("/:id/clearance/start", checkPermission("resignations", "edit"), startClearance);
router.put("/:id/clearance", checkPermission("resignations", "edit"), setClearance);
router.patch("/:id/clearance/:itemId", checkPermission("resignations", "edit"), updateClearanceItem);
router.put("/:id/exit-interview", checkPermission("resignations", "edit"), saveExitInterview);
router.delete("/:id", checkPermission("resignations", "delete"), deleteResignation);

export default router;
