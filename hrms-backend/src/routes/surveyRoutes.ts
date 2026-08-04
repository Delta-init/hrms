import { Router } from "express";
import {
  createSurvey, getSurveys, getSurveyById, updateSurvey, setSurveyStatus, deleteSurvey, getSurveyResults,
  getMySurveys, submitMySurveyResponse,
} from "../controllers/surveyController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Self-service — no module permission; scoped server-side to the caller's own responses.
router.get("/mine", getMySurveys);
router.post("/:id/responses", submitMySurveyResponse);

// `surveys.view` also drives self-service nav visibility (Employees hold it
// too, for /mine), so the admin listing/results/detail routes below require
// `edit` instead — otherwise every employee could browse and read the
// results of every survey via the org-wide endpoints.
router.get("/", checkPermission("surveys", "edit"), getSurveys);
router.post("/", checkPermission("surveys", "create"), createSurvey);
router.get("/:id/results", checkPermission("surveys", "edit"), getSurveyResults);
router.get("/:id", checkPermission("surveys", "edit"), getSurveyById);
router.put("/:id", checkPermission("surveys", "edit"), updateSurvey);
router.patch("/:id/status", checkPermission("surveys", "edit"), setSurveyStatus);
router.delete("/:id", checkPermission("surveys", "delete"), deleteSurvey);

export default router;
