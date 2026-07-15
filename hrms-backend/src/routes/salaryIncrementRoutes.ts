import { Router } from "express";
import {
  createIncrement, getIncrements, getIncrementById, updateIncrement, deleteIncrement,
} from "../controllers/salaryIncrementController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

router.get("/", checkPermission("salaryIncrements", "view"), getIncrements);
router.post("/", checkPermission("salaryIncrements", "create"), createIncrement);
router.get("/:id", checkPermission("salaryIncrements", "view"), getIncrementById);
router.put("/:id", checkPermission("salaryIncrements", "edit"), updateIncrement);
router.delete("/:id", checkPermission("salaryIncrements", "delete"), deleteIncrement);

export default router;
