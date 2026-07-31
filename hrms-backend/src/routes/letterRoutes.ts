import { Router } from "express";
import {
  createLetterTemplate, getLetterTemplates, getLetterTemplateById, updateLetterTemplate, deleteLetterTemplate,
  generateLetter, getGeneratedLetters, getGeneratedLetterById, updateGeneratedLetter, deleteGeneratedLetter,
} from "../controllers/letterController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Generated letters (declared before "/templates/:id"-style dynamic routes so they aren't shadowed).
router.get("/generated", checkPermission("letters", "view"), getGeneratedLetters);
router.post("/generated", checkPermission("letters", "create"), generateLetter);
router.get("/generated/:id", checkPermission("letters", "view"), getGeneratedLetterById);
router.put("/generated/:id", checkPermission("letters", "edit"), updateGeneratedLetter);
router.delete("/generated/:id", checkPermission("letters", "delete"), deleteGeneratedLetter);

router.get("/templates", checkPermission("letters", "view"), getLetterTemplates);
router.post("/templates", checkPermission("letters", "create"), createLetterTemplate);
router.get("/templates/:id", checkPermission("letters", "view"), getLetterTemplateById);
router.put("/templates/:id", checkPermission("letters", "edit"), updateLetterTemplate);
router.delete("/templates/:id", checkPermission("letters", "delete"), deleteLetterTemplate);

export default router;
