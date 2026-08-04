import { Router } from "express";
import {
  createAttendance,
  getAttendance,
  getAttendanceById,
  updateAttendance,
  deleteAttendance,
  getTodayAttendance,
  getMyAttendance,
  getAttendanceCalendar,
  clockIn,
  clockOut,
} from "../controllers/attendanceController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();

router.use(authenticate);

// Self-service (own attendance) — no module permission needed.
router.get("/today", getTodayAttendance);
router.get("/mine", getMyAttendance);
router.post("/clock-in", clockIn);
router.post("/clock-out", clockOut);

router.get("/", checkPermission("attendance", "view"), getAttendance);
router.get("/calendar", checkPermission("attendance", "view"), getAttendanceCalendar);
// Recording attendance for an arbitrary employee (vs. self-service clock-in
// above) and looking up a record by id are manager-only actions.
router.post("/", checkPermission("attendance", "edit"), createAttendance);
router.get("/:id", checkPermission("attendance", "edit"), getAttendanceById);
router.put("/:id", checkPermission("attendance", "edit"), updateAttendance);
router.delete("/:id", checkPermission("attendance", "delete"), deleteAttendance);

export default router;
