import { Router } from "express";
import {
  createRequisition, getRequisitions, getRequisitionById,
  updateRequisition, reviewRequisition, deleteRequisition, getHiringWorkflowState,
} from "../controllers/jobRequisitionController.js";
import {
  createCandidate, getCandidates, getCandidateById, updateCandidate, deleteCandidate,
  uploadResume, applyCandidate, getPipeline, getApplications, moveApplication, deleteApplication,
} from "../controllers/candidateController.js";
import { authenticate } from "../middleware/auth.js";
import { uploadSingle } from "../middleware/upload.js";
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

// ── Candidates ───────────────────────────────────────────────────────────────
router.get("/candidates", checkPermission("hiring", "view"), getCandidates);
router.post("/candidates", checkPermission("hiring", "create"), createCandidate);
router.get("/candidates/:id", checkPermission("hiring", "view"), getCandidateById);
router.put("/candidates/:id", checkPermission("hiring", "edit"), updateCandidate);
router.post("/candidates/:id/resume", checkPermission("hiring", "edit"), uploadSingle, uploadResume);
router.delete("/candidates/:id", checkPermission("hiring", "delete"), deleteCandidate);

// ── Applications ─────────────────────────────────────────────────────────────
router.get("/applications", checkPermission("hiring", "view"), getApplications);
router.post("/applications", checkPermission("hiring", "create"), applyCandidate);
router.patch("/applications/:id", checkPermission("hiring", "edit"), moveApplication);
router.delete("/applications/:id", checkPermission("hiring", "delete"), deleteApplication);
router.get("/requisitions/:id/pipeline", checkPermission("hiring", "view"), getPipeline);

export default router;
