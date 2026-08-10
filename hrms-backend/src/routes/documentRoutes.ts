import { Router } from "express";
import { getDocumentsOverview } from "../controllers/documentController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();

router.use(authenticate);

// Reading the whole organization's documents is a manager view: it lists other
// people's passport numbers and expiry dates. Self-service stays on /auth/documents.
router.get("/", checkPermission("employees", "view"), getDocumentsOverview);

export default router;
