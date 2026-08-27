import { Router } from "express";
import { serviceAuth } from "../middleware/serviceAuth.js";
import { listOrganizations, listDepartments, listEmployees, ping } from "../controllers/integrationController.js";

const router = Router();

// Signed machine calls only. No `authenticate`, and therefore no org context:
// every handler below takes the organization as an explicit parameter.
router.use(serviceAuth);

router.get("/ping", ping);
router.get("/directory/organizations", listOrganizations);
router.get("/directory/departments", listDepartments);
router.get("/directory/employees", listEmployees);

export default router;
