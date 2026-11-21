import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
import { uploadSingle } from "../middleware/upload.js";
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

// Phase 2. Employee routes again carry no permission here; the services decide.
router.post("/uploads", uploadSingle, c.postUpload);
router.get("/nominations", c.getNominations);
router.post("/nominations", c.postNomination);
router.get("/colleagues", c.getColleagues);

router.get("/rewards", c.getRewards);
router.post("/rewards", checkPermission("dgoRewards", "create"), c.postReward);
router.put("/rewards/:id", checkPermission("dgoRewards", "edit"), c.putReward);
router.delete("/rewards/:id", checkPermission("dgoRewards", "delete"), c.deleteReward);

router.get("/redemptions", c.getRedemptions);
router.post("/redemptions", c.postRedemption);
router.post("/redemptions/:id/cancel", c.postCancelRedemption);
router.post("/redemptions/:id/approve", checkPermission("dgoRewards", "approve"), c.postApproveRedemption);
router.post("/redemptions/:id/reject", checkPermission("dgoRewards", "approve"), c.postRejectRedemption);
router.post("/redemptions/:id/fulfil", checkPermission("dgoRewards", "approve"), c.postFulfilRedemption);

router.get("/leaderboard", c.getLeaderboard);

router.get("/achievers", c.getAchievers);
router.post("/achievers/:month/fetch", checkPermission("dgoSettings", "edit"), c.postFetchAchievers);
router.post("/achievers/:month/pick", checkPermission("dgoSettings", "edit"), c.postPickAchiever);
router.post("/achievers/:month/verify", checkPermission("dgoBudgets", "approve"), c.postVerifyAchievers);
router.post("/achievers/:month/send-back", c.postSendBackAchievers);
router.post("/achievers/:month/approve", checkPermission("dgoSettings", "approve"), c.postApproveAchievers);

// Phase 3: month close, controls (two finance people), reports.
router.post("/budgets/:month/collections/fetch", checkPermission("dgoBudgets", "edit"), c.postFetchCollections);
router.post("/budgets/:month/close/request", checkPermission("dgoBudgets", "edit"), c.postCloseRequest);
router.post("/budgets/:month/close/approve", checkPermission("dgoBudgets", "approve"), c.postCloseApprove);
router.post("/budgets/:month/close/cancel", c.postCloseCancel);
router.post("/budgets/:month/overrides", checkPermission("dgoBudgets", "edit"), c.postOverride);
router.post("/overrides/:id/approve", checkPermission("dgoBudgets", "approve"), c.postOverrideApprove);
router.post("/overrides/:id/reject", checkPermission("dgoBudgets", "approve"), c.postOverrideReject);
router.get("/adjustments", checkPermission("dgoBudgets", "view"), c.getAdjustments);
router.post("/adjustments", checkPermission("dgoBudgets", "edit"), c.postAdjustment);
router.post("/adjustments/:id/approve", checkPermission("dgoBudgets", "approve"), c.postAdjustmentApprove);
router.post("/adjustments/:id/reject", checkPermission("dgoBudgets", "approve"), c.postAdjustmentReject);
router.get("/reports/overview", c.getReportsOverview);
router.get("/reports/reconciliation", c.getReconciliation);
router.get("/reports/export", c.getExport);

// Phase 4: feeds and suggestions.
router.get("/integrations", c.getIntegrations);
router.post("/integrations/kpi/run", checkPermission("dgoSettings", "edit"), c.postKpiRun);
router.get("/suggestions", c.getSuggestions);
router.post("/suggestions/:id/record", c.postSuggestionRecord);
router.post("/suggestions/:id/dismiss", c.postSuggestionDismiss);

export default router;
