import { Router } from "express";
import {
  createLeavePolicy, getLeavePolicies, updateLeavePolicy, deleteLeavePolicy,
  getMyLeaveBalances, getLeaveBalancesFor,
} from "../controllers/leaveBalanceController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Self-service — own balances, no module permission required.
router.get("/mine", getMyLeaveBalances);

// Policy config + any-employee balances are part of the leave module.
router.get("/policies", checkPermission("leave", "view"), getLeavePolicies);
router.post("/policies", checkPermission("leave", "create"), createLeavePolicy);
router.put("/policies/:id", checkPermission("leave", "edit"), updateLeavePolicy);
router.delete("/policies/:id", checkPermission("leave", "delete"), deleteLeavePolicy);
router.get("/:userId", checkPermission("leave", "view"), getLeaveBalancesFor);

export default router;
