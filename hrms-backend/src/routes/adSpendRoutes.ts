import { Router } from "express";
import {
  canReadPlatforms, getSettings, updateSettings, getPlatformNames, getRequisitions, getOverview,
  listWeeks, getWeek, saveWeek, deleteWeek, addAttachment, removeAttachment,
} from "../controllers/adSpendController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
import { uploadDocumentSingle } from "../middleware/upload.js";

/**
 * Recruitment ad spend. view reads, create logs and corrects a week, edit sets
 * the platforms and budget, delete removes a week.
 */
const router = Router();
router.use(authenticate);

router.get("/platforms", canReadPlatforms, getPlatformNames);
router.get("/settings", checkPermission("adSpend", "view"), getSettings);
router.put("/settings", checkPermission("adSpend", "edit"), updateSettings);
router.get("/requisitions", checkPermission("adSpend", "view"), getRequisitions);
router.get("/overview", checkPermission("adSpend", "view"), getOverview);
router.get("/weeks", checkPermission("adSpend", "view"), listWeeks);
router.get("/weeks/:weekStart", checkPermission("adSpend", "view"), getWeek);
router.put("/weeks/:weekStart", checkPermission("adSpend", "create"), saveWeek);
router.delete("/weeks/:weekStart", checkPermission("adSpend", "delete"), deleteWeek);
router.post("/weeks/:weekStart/attachments", checkPermission("adSpend", "create"), uploadDocumentSingle, addAttachment);
router.delete("/weeks/:weekStart/attachments/:attachmentId", checkPermission("adSpend", "create"), removeAttachment);

export default router;
