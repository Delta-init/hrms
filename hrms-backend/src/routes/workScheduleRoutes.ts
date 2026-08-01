import { Router } from "express";
import {
  createWorkSchedule,
  getWorkSchedules,
  getAllWorkSchedulesSimple,
  getWorkScheduleById,
  updateWorkSchedule,
  deleteWorkSchedule,
  assignRoster,
  getRosterAssignments,
  updateRosterAssignment,
  deleteRosterAssignment,
  getAttendancePenaltyPolicy,
  updateAttendancePenaltyPolicy,
} from "../controllers/workScheduleController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();

router.use(authenticate);

// Simple list for dropdowns (assigning to users/holidays)
router.get("/all", checkPermission("workSchedules", "view"), getAllWorkSchedulesSimple);

// Roster assignments (declared before "/:id" so they aren't shadowed).
router.get("/roster", checkPermission("workSchedules", "view"), getRosterAssignments);
router.post("/roster", checkPermission("workSchedules", "create"), assignRoster);
router.put("/roster/:id", checkPermission("workSchedules", "edit"), updateRosterAssignment);
router.delete("/roster/:id", checkPermission("workSchedules", "delete"), deleteRosterAssignment);

// Late-arrival penalty policy (singleton, declared before "/:id" so it isn't shadowed).
router.get("/penalty-policy", checkPermission("workSchedules", "view"), getAttendancePenaltyPolicy);
router.put("/penalty-policy", checkPermission("workSchedules", "edit"), updateAttendancePenaltyPolicy);

router.get("/", checkPermission("workSchedules", "view"), getWorkSchedules);
router.post("/", checkPermission("workSchedules", "create"), createWorkSchedule);
router.get("/:id", checkPermission("workSchedules", "view"), getWorkScheduleById);
router.put("/:id", checkPermission("workSchedules", "edit"), updateWorkSchedule);
router.delete("/:id", checkPermission("workSchedules", "delete"), deleteWorkSchedule);

export default router;
