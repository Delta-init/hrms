import { Router } from "express";
import {
  createRequisition, getRequisitions, getRequisitionById,
  updateRequisition, reviewRequisition, deleteRequisition, getHiringWorkflowState,
} from "../controllers/jobRequisitionController.js";
import {
  createCandidate, getCandidates, getCandidateById, updateCandidate, deleteCandidate,
  uploadResume, applyCandidate, getPipeline, getApplications, moveApplication, deleteApplication,
} from "../controllers/candidateController.js";
import {
  scheduleInterview, getInterviews, getInterviewById, updateInterview,
  cancelInterview, deleteInterview, getConflicts, submitFeedback, deleteFeedback,
} from "../controllers/interviewController.js";
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

// ── Interviews ───────────────────────────────────────────────────────────────
router.get("/interviews/conflicts", checkPermission("hiring", "view"), getConflicts);
router.get("/interviews", checkPermission("hiring", "view"), getInterviews);
router.post("/interviews", checkPermission("hiring", "create"), scheduleInterview);
router.get("/interviews/:id", checkPermission("hiring", "view"), getInterviewById);
router.put("/interviews/:id", checkPermission("hiring", "edit"), updateInterview);
router.patch("/interviews/:id/cancel", checkPermission("hiring", "edit"), cancelInterview);
router.delete("/interviews/:id", checkPermission("hiring", "delete"), deleteInterview);
// Leaving feedback is not an edit right — the panel writes their own verdict,
// and the service refuses anyone not on it.
router.post("/interviews/:id/feedback", checkPermission("hiring", "view"), submitFeedback);
router.delete("/feedback/:id", checkPermission("hiring", "view"), deleteFeedback);

export default router;
