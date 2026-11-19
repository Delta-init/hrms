import { Router } from "express";
import {
  createLoan, getLoans, getLoanById, updateLoan, deleteLoan,
  getLoanHistory, getMyLoans, planLoanMonth, clearLoanMonth, addLoanPayment, removeLoanPayment,
} from "../controllers/loanController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Your own loans and advances, read-only — no loans permission needed.
router.get("/mine", getMyLoans);

router.get("/", checkPermission("loans", "view"), getLoans);
router.post("/", checkPermission("loans", "create"), createLoan);
router.get("/:id", checkPermission("loans", "view"), getLoanById);
router.put("/:id", checkPermission("loans", "edit"), updateLoan);
router.delete("/:id", checkPermission("loans", "delete"), deleteLoan);
router.get("/:id/history", checkPermission("loans", "view"), getLoanHistory);
router.put("/:id/months/:month", checkPermission("loans", "edit"), planLoanMonth);
router.delete("/:id/months/:month", checkPermission("loans", "edit"), clearLoanMonth);
router.post("/:id/payments", checkPermission("loans", "edit"), addLoanPayment);
router.delete("/:id/payments/:paymentId", checkPermission("loans", "edit"), removeLoanPayment);

export default router;
