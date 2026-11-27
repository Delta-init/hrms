import { Router } from "express";
import {
  canReadPlatforms, adSpendAccess, getAccess, getSettings, updateSettings, getPlatformNames, getRequisitions, getOverview,
  listWeeks, getWeek, saveWeek, deleteWeek, addAttachment, removeAttachment,
} from "../controllers/adSpendController.js";
import { authenticate } from "../middleware/auth.js";
import { uploadDocumentSingle } from "../middleware/upload.js";

/**
 * Recruitment ad spend. view reads, create logs and corrects a week, edit sets
 * the platforms and budget, delete removes a week.
 */
const router = Router();
router.use(authenticate);

// Reading and logging also open to the HR department (2026-11-27) — see adSpendAccess.
router.get("/access", getAccess);
router.get("/platforms", canReadPlatforms, getPlatformNames);
router.get("/settings", adSpendAccess("view"), getSettings);
router.put("/settings", adSpendAccess("edit"), updateSettings);
router.get("/requisitions", adSpendAccess("view"), getRequisitions);
router.get("/overview", adSpendAccess("view"), getOverview);
router.get("/weeks", adSpendAccess("view"), listWeeks);
router.get("/weeks/:weekStart", adSpendAccess("view"), getWeek);
router.put("/weeks/:weekStart", adSpendAccess("create"), saveWeek);
router.delete("/weeks/:weekStart", adSpendAccess("delete"), deleteWeek);
router.post("/weeks/:weekStart/attachments", adSpendAccess("create"), uploadDocumentSingle, addAttachment);
router.delete("/weeks/:weekStart/attachments/:attachmentId", adSpendAccess("create"), removeAttachment);

export default router;
