import { Router } from "express";
import {
  createRequest, getMyRequests, getRequests, setStatus, withdrawRequest,
} from "../controllers/officeKeepingController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
import { uploadSingle } from "../middleware/upload.js";

/**
 * Raising is open to everybody, on purpose.
 *
 * The person who notices a broken chair is whoever sat in it, and there is no
 * approval to pass — only somebody to tell. So creating and reading your own
 * carry no module permission, exactly as applying for leave does not.
 *
 * The panel is the gated half: `approve` means "may move a request along",
 * which is office keeping's job and HR's when they are covering.
 */
const router = Router();
router.use(authenticate);

// Self-service.
router.post("/", uploadSingle, createRequest);
router.get("/mine", getMyRequests);
router.patch("/:id/withdraw", withdrawRequest);

// The panel.
router.get("/", checkPermission("officeKeeping", "approve"), getRequests);
router.patch("/:id/status", checkPermission("officeKeeping", "approve"), setStatus);

export default router;
