import { Router } from "express";
import {
  createWorkSchedule,
  getWorkSchedules,
  getAllWorkSchedulesSimple,
  getWorkScheduleById,
  updateWorkSchedule,
  deleteWorkSchedule,
} from "../controllers/workScheduleController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();

router.use(authenticate);

// Simple list for dropdowns (assigning to users/holidays)
router.get("/all", checkPermission("workSchedules", "view"), getAllWorkSchedulesSimple);

router.get("/", checkPermission("workSchedules", "view"), getWorkSchedules);
router.post("/", checkPermission("workSchedules", "create"), createWorkSchedule);
router.get("/:id", checkPermission("workSchedules", "view"), getWorkScheduleById);
router.put("/:id", checkPermission("workSchedules", "edit"), updateWorkSchedule);
router.delete("/:id", checkPermission("workSchedules", "delete"), deleteWorkSchedule);

export default router;
