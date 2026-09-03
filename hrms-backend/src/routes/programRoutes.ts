import { Router } from "express";
import {
  createProgram, getPrograms, getProgramById, updateProgram, deleteProgram,
  getProgramRegistrations, getMyPrograms, registerForProgram, cancelMyRegistration,
} from "../controllers/programController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Self-service — taking a place on a staff program is like raising leave, and
// needs no module permission. Above "/:id", or "mine" is read as a program id.
router.get("/mine", getMyPrograms);
router.post("/:id/register", registerForProgram);
router.delete("/:id/register", cancelMyRegistration);

router.get("/", checkPermission("programs", "view"), getPrograms);
router.post("/", checkPermission("programs", "create"), createProgram);
// The register names everybody who is going, so it sits with managing the
// program rather than with booking a place on it.
router.get("/:id/registrations", checkPermission("programs", "edit"), getProgramRegistrations);
router.get("/:id", checkPermission("programs", "view"), getProgramById);
router.put("/:id", checkPermission("programs", "edit"), updateProgram);
router.delete("/:id", checkPermission("programs", "delete"), deleteProgram);

export default router;
