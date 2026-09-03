import { Router } from "express";
import {
  listBackups, getBackup, createBackup, downloadBackup, previewRestore, restoreCollection,
} from "../controllers/backupController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// No `checkPermission`: an archive is every collection in one file, so the gate
// is the Super Admin check inside the controller rather than a module
// permission somebody could be granted by mistake.
router.use(authenticate);

router.get("/", listBackups);
router.post("/", createBackup);
// Above "/:id", which would otherwise swallow them.
router.get("/:id/download", downloadBackup);
router.get("/:id/preview", previewRestore);
router.post("/:id/restore", restoreCollection);
router.get("/:id", getBackup);

export default router;
