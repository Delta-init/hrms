import { Router } from "express";
import {
  createAsset, getAssets, getAssetFacets, getMyAssets, getAssetById, updateAsset, deleteAsset,
  issueAsset, returnAsset, markAssetAvailable, retireAsset,
} from "../controllers/assetController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Self-service — own assigned assets, no module permission required.
router.get("/mine", getMyAssets);

router.get("/", checkPermission("assets", "view"), getAssets);
// Before "/:id", or "facets" is read as an asset id.
router.get("/facets", checkPermission("assets", "view"), getAssetFacets);
router.post("/", checkPermission("assets", "create"), createAsset);
router.get("/:id", checkPermission("assets", "view"), getAssetById);
router.put("/:id", checkPermission("assets", "edit"), updateAsset);
router.patch("/:id/issue", checkPermission("assets", "edit"), issueAsset);
router.patch("/:id/return", checkPermission("assets", "edit"), returnAsset);
router.patch("/:id/available", checkPermission("assets", "edit"), markAssetAvailable);
router.patch("/:id/retire", checkPermission("assets", "edit"), retireAsset);
router.delete("/:id", checkPermission("assets", "delete"), deleteAsset);

export default router;
