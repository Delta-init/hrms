import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
import * as c from "../controllers/dgoController.js";

/**
 * DGO Points. Employee routes carry no permission here: the service lets
 * anybody in once the program is open (and staff with a DGO permission, heads
 * and Super Admins before then), and scopes everything to the caller. Staff
 * routes are gated here and again in the service.
 */
const router = Router();
router.use(authenticate);

router.get("/me", c.getMe);
router.get("/dashboard", c.getDashboard);
router.get("/wallet", c.getWallet);
router.get("/wallet/lots", c.getLots);
router.get("/rules", c.getRules);
router.get("/employees", c.getEmployees);

router.post("/earnings", c.postEarning);
router.post("/earnings/:id/reverse", checkPermission("dgoBudgets", "edit"), c.postReverse);
router.get("/approvals", c.getApprovals);
router.post("/approvals/:id/decision", c.postDecision);

router.get("/budgets", checkPermission("dgoBudgets", "view"), c.getBudget);
router.post("/budgets/:month/collections", checkPermission("dgoBudgets", "edit"), c.postCollections);
router.post("/budgets/:month/collections/confirm", checkPermission("dgoBudgets", "approve"), c.postConfirmCollections);
router.post("/budgets/:month/recount", checkPermission("dgoBudgets", "edit"), c.postRecount);

router.get("/settings", checkPermission("dgoSettings", "view"), c.getSettings);
router.put("/settings", checkPermission("dgoSettings", "edit"), c.putSettings);
router.put("/rules/:code", checkPermission("dgoSettings", "edit"), c.putRule);
router.put("/program", checkPermission("dgoSettings", "edit"), c.putProgram);

router.get("/audit", checkPermission("dgoAudit", "view"), c.getAudit);

export default router;
