import { Router } from "express";
import { getDocumentsOverview, ignoreDocumentRows, unignoreDocumentRows } from "../controllers/documentController.js";
import {
  getCompanyDocuments, addCompanyDocument, editCompanyDocument, removeCompanyDocument,
} from "../controllers/companyDocumentController.js";
import { authenticate } from "../middleware/auth.js";
import { uploadSingle } from "../middleware/upload.js";
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

/*
 * Company documents — trade licences, tenancy contracts, insurance. Not one
 * person's papers, so they sit beside the employee overview rather than under
 * an employee, but they are read and edited by the same people and carry the
 * same permission.
 */
router.get("/company", checkPermission("employees", "view"), getCompanyDocuments);
router.post("/company", checkPermission("employees", "edit"), uploadSingle, addCompanyDocument);
router.put("/company/:id", checkPermission("employees", "edit"), uploadSingle, editCompanyDocument);
router.delete("/company/:id", checkPermission("employees", "delete"), removeCompanyDocument);

export default router;
