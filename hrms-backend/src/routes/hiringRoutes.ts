import { Router } from "express";
import {
  createRequisition, getRequisitions, getRequisitionById,
  updateRequisition, reviewRequisition, deleteRequisition, getHiringWorkflowState,
} from "../controllers/jobRequisitionController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();

router.use(authenticate);

router.get("/workflow", checkPermission("hiring", "view"), getHiringWorkflowState);

router.get("/requisitions", checkPermission("hiring", "view"), getRequisitions);
router.post("/requisitions", checkPermission("hiring", "create"), createRequisition);
router.get("/requisitions/:id", checkPermission("hiring", "view"), getRequisitionById);
router.put("/requisitions/:id", checkPermission("hiring", "edit"), updateRequisition);
// Approving is its own permission, and the workflow narrows it further to the
// role holding the current step.
router.patch("/requisitions/:id/review", checkPermission("hiring", "approve"), reviewRequisition);
router.delete("/requisitions/:id", checkPermission("hiring", "delete"), deleteRequisition);

export default router;
