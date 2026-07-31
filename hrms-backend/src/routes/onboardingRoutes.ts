import { Router } from "express";
import {
  createTemplate, getTemplates, getTemplateById, updateTemplate, deleteTemplate,
  createChecklist, getChecklists, getChecklistById, deleteChecklist, setTaskStatus,
  getMyChecklist, setMyTaskStatus,
} from "../controllers/onboardingController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Self-service — no module permission; scoped server-side to the caller's own checklist.
router.get("/my-tasks", getMyChecklist);
router.patch("/my-tasks/:taskId", setMyTaskStatus);

router.get("/templates", checkPermission("onboardingTasks", "view"), getTemplates);
router.post("/templates", checkPermission("onboardingTasks", "create"), createTemplate);
router.get("/templates/:id", checkPermission("onboardingTasks", "view"), getTemplateById);
router.put("/templates/:id", checkPermission("onboardingTasks", "edit"), updateTemplate);
router.delete("/templates/:id", checkPermission("onboardingTasks", "delete"), deleteTemplate);

router.get("/checklists", checkPermission("onboardingTasks", "view"), getChecklists);
router.post("/checklists", checkPermission("onboardingTasks", "create"), createChecklist);
router.get("/checklists/:id", checkPermission("onboardingTasks", "view"), getChecklistById);
router.delete("/checklists/:id", checkPermission("onboardingTasks", "delete"), deleteChecklist);
router.patch("/checklists/:id/tasks/:taskId", checkPermission("onboardingTasks", "edit"), setTaskStatus);

export default router;
