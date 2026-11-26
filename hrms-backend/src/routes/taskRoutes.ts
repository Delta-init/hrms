import { Router } from "express";
import {
  listTasks, taskSummary, myTaskSummary, getTask, createTask, updateTask, cancelTask, toggleTaskStep, submitTask,
  reviewTask, listTaskCategories, createTaskCategory, updateTaskCategory,
  listTaskSeries, getTaskSeries, updateTaskSeries, setTaskSeriesState,
} from "../controllers/taskController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
import { uploadTaskFiles } from "../middleware/upload.js";
import {
  listDayPlans, getDayPlan, createDayPlan, updateDayPlan, dayOfPlan, myDays, tickDayItem, tickDayStep, addDayItem,
  reorderDay, setDayItemLength, removeDayItem, dayRoundDone,
} from "../controllers/dayPlanController.js";

/*
 * Tasks (2026-11-25). Your own tasks — listing, ticking steps, marking done — need no permission: the service only
 * lets the assignee touch them. Everything else is the `tasks` module.
 */
const router = Router();
router.use(authenticate);

// Before "/:id".
router.get("/summary", checkPermission("tasks", "view"), taskSummary);
router.get("/mine/summary", myTaskSummary);
router.get("/categories", listTaskCategories);
router.post("/categories", checkPermission("tasks", "create"), createTaskCategory);
router.put("/categories/:id", checkPermission("tasks", "edit"), updateTaskCategory);
// Repeating tasks (Part 2).
router.get("/series", checkPermission("tasks", "view"), listTaskSeries);
router.get("/series/:id", checkPermission("tasks", "view"), getTaskSeries);
router.put("/series/:id", checkPermission("tasks", "edit"), updateTaskSeries);
router.patch("/series/:id/state", checkPermission("tasks", "edit"), setTaskSeriesState);

// Day plans (2026-11-26): HR's routines, and each person's own day.
router.get("/day-plans", checkPermission("tasks", "view"), listDayPlans);
router.post("/day-plans", checkPermission("tasks", "create"), createDayPlan);
router.get("/day-plans/:id", checkPermission("tasks", "view"), getDayPlan);
router.put("/day-plans/:id", checkPermission("tasks", "edit"), updateDayPlan);
router.get("/day-plans/:id/day", checkPermission("tasks", "view"), dayOfPlan);
router.get("/my-day", myDays);
router.patch("/my-day/:dayId/items/:itemId", tickDayItem);
router.patch("/my-day/:dayId/items/:itemId/steps/:stepId", tickDayStep);
router.patch("/my-day/:dayId/items/:itemId/length", setDayItemLength);
router.delete("/my-day/:dayId/items/:itemId", removeDayItem);
router.post("/my-day/:dayId/items", addDayItem);
router.put("/my-day/:dayId/order", reorderDay);
router.post("/my-day/:dayId/rounds", dayRoundDone);

router.get("/", listTasks);
router.post("/", checkPermission("tasks", "create"), createTask);
router.get("/:id", getTask);
router.put("/:id", checkPermission("tasks", "edit"), updateTask);
router.patch("/:id/cancel", checkPermission("tasks", "edit"), cancelTask);
router.patch("/:id/steps/:stepId", toggleTaskStep);
router.post("/:id/submit", uploadTaskFiles, submitTask);
router.patch("/:id/review", checkPermission("tasks", "approve"), reviewTask);

export default router;
