import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
import { uploadSingle, uploadVideoSingle } from "../middleware/upload.js";
import {
  getMyAgreements, startInduction, inductionHeartbeat, signAgreements,
  uploadTemplate, listTemplates, uploadInductionVideo,
  listSignedAgreements, getSignedAgreement, reviewAgreement,
} from "../controllers/agreementController.js";

const router = Router();
router.use(authenticate);

// ── The new joiner's own gate ──
// No permission check: everybody signs their own, and the service resolves the
// employee from the token rather than from anything the caller supplies.
router.get("/me", getMyAgreements);
router.post("/induction/start", startInduction);
router.post("/induction/heartbeat", inductionHeartbeat);
router.post("/sign", signAgreements);

// ── HR ──
router.get("/", checkPermission("employees", "view"), listSignedAgreements);
router.get("/templates", checkPermission("employees", "view"), listTemplates);
router.post("/:id/review", checkPermission("employees", "approve"), reviewAgreement);
router.get("/:id", checkPermission("employees", "view"), getSignedAgreement);

// ── Administration ──
// Replacing an agreement changes what every future joiner signs, so it sits
// behind settings rather than the broader employee permission.
router.post("/templates", checkPermission("settings", "edit"), uploadSingle, uploadTemplate);
router.post("/induction/video", checkPermission("settings", "edit"), uploadVideoSingle, uploadInductionVideo);

export default router;
