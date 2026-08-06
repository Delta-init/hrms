import { Router } from "express";
import {
  getDueConfirmations, getConfirmations, getConfirmationById,
  initiateConfirmation, reviewConfirmation, withdrawConfirmation,
} from "../controllers/confirmationController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Must precede "/:id".
router.get("/due", checkPermission("confirmations", "view"), getDueConfirmations);

router.get("/", checkPermission("confirmations", "view"), getConfirmations);
router.post("/", checkPermission("confirmations", "create"), initiateConfirmation);
router.get("/:id", checkPermission("confirmations", "view"), getConfirmationById);
// Deciding a confirmation is its own permission, separate from raising one.
router.patch("/:id/review", checkPermission("confirmations", "approve"), reviewConfirmation);
router.delete("/:id", checkPermission("confirmations", "delete"), withdrawConfirmation);

export default router;
