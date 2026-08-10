import { Router } from "express";
import { getFile } from "../controllers/fileController.js";

const router = Router();

// No `authenticate`: the signed link is the credential. See fileController.
// The wildcard captures the whole key, which contains slashes.
router.get("/*", getFile);

export default router;
