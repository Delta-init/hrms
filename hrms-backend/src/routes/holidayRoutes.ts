import { Router } from "express";
import {
  createHoliday,
  getHolidays,
  getHolidayById,
  updateHoliday,
  deleteHoliday,
} from "../controllers/holidayController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();

router.use(authenticate);

// Holiday calendar is part of the leave module.
router.get("/", checkPermission("leave", "view"), getHolidays);
router.post("/", checkPermission("leave", "create"), createHoliday);
router.get("/:id", checkPermission("leave", "view"), getHolidayById);
router.put("/:id", checkPermission("leave", "edit"), updateHoliday);
router.delete("/:id", checkPermission("leave", "delete"), deleteHoliday);

export default router;
