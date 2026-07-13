import { Router } from "express";
import {
  createOrganization, getOrganizations, getAllOrganizations,
  getOrganizationById, updateOrganization, deleteOrganization,
} from "../controllers/organizationController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

// Only the Super Admin holds the "organizations" permission, so these are
// effectively Super-Admin-only (Super Admin bypasses the permission check).
const router = Router();
router.use(authenticate);

router.get("/", checkPermission("organizations", "view"), getOrganizations);
router.get("/all", checkPermission("organizations", "view"), getAllOrganizations);
router.post("/", checkPermission("organizations", "create"), createOrganization);
router.get("/:id", checkPermission("organizations", "view"), getOrganizationById);
router.put("/:id", checkPermission("organizations", "edit"), updateOrganization);
router.delete("/:id", checkPermission("organizations", "delete"), deleteOrganization);

export default router;
