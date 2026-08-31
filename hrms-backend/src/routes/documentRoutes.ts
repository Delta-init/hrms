import { Router } from "express";
import { getDocumentsOverview, ignoreDocumentRows, unignoreDocumentRows } from "../controllers/documentController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();

router.use(authenticate);

// Reading the whole organization's documents is a manager view: it lists other
// people's passport numbers and expiry dates. Self-service stays on /auth/documents.
router.get("/", checkPermission("employees", "view"), getDocumentsOverview);

// Deciding a document is not worth chasing changes what everybody else sees is
// outstanding, so it takes edit rather than view.
router.post("/ignore", checkPermission("employees", "edit"), ignoreDocumentRows);
router.post("/unignore", checkPermission("employees", "edit"), unignoreDocumentRows);

export default router;
