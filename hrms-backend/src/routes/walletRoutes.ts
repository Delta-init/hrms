import { Router } from "express";
import { getMyWallet, getEmployeeWallet } from "../controllers/walletController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Self-service, and ahead of "/:employeeId".
router.get("/mine", getMyWallet);
router.get("/:employeeId", checkPermission("payroll", "view"), getEmployeeWallet);

export default router;
