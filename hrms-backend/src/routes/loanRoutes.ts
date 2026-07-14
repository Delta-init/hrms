import { Router } from "express";
import {
  createLoan, getLoans, getLoanById, updateLoan, deleteLoan,
} from "../controllers/loanController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

router.get("/", checkPermission("loans", "view"), getLoans);
router.post("/", checkPermission("loans", "create"), createLoan);
router.get("/:id", checkPermission("loans", "view"), getLoanById);
router.put("/:id", checkPermission("loans", "edit"), updateLoan);
router.delete("/:id", checkPermission("loans", "delete"), deleteLoan);

export default router;
