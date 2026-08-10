import { Router } from "express";
import {
  deleteFaceProfile,
  enrollFace,
  getFaceEnrollmentSummary,
  getFaceSettings,
  getFaceStatus,
  syncFaceGallery,
} from "../controllers/faceController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();

router.use(authenticate);

router.get("/settings", getFaceSettings);

// Managing your own face data needs no module permission; the controller
// checks employees.edit before it will touch anybody else's.
router.get("/profiles/:userId", getFaceStatus);
router.post("/profiles/:userId", enrollFace);
router.delete("/profiles/:userId", deleteFaceProfile);

router.get("/enrolled", checkPermission("employees", "view"), getFaceEnrollmentSummary);
router.post("/sync", checkPermission("employees", "edit"), syncFaceGallery);

export default router;
