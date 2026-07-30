import { Router } from "express";
import {
  createAsset, getAssets, getAssetById, updateAsset, deleteAsset,
  issueAsset, returnAsset, markAssetAvailable, retireAsset,
} from "../controllers/assetController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

router.get("/", checkPermission("assets", "view"), getAssets);
router.post("/", checkPermission("assets", "create"), createAsset);
router.get("/:id", checkPermission("assets", "view"), getAssetById);
router.put("/:id", checkPermission("assets", "edit"), updateAsset);
router.patch("/:id/issue", checkPermission("assets", "edit"), issueAsset);
router.patch("/:id/return", checkPermission("assets", "edit"), returnAsset);
router.patch("/:id/available", checkPermission("assets", "edit"), markAssetAvailable);
router.patch("/:id/retire", checkPermission("assets", "edit"), retireAsset);
router.delete("/:id", checkPermission("assets", "delete"), deleteAsset);

export default router;
