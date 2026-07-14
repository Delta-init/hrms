import { Router } from "express";
import {
  login,
  setPassword,
  exchange,
  refreshToken,
  getProfile,
  changePassword,
  getMyProfile,
  completeProfile,
} from "../controllers/authController.js";
import {
  listDocuments,
  uploadDocument,
  deleteDocument,
} from "../controllers/documentController.js";
import { authenticate } from "../middleware/auth.js";
import { uploadSingle } from "../middleware/upload.js";

const router = Router();

// Public routes
router.post("/login", login);
router.post("/set-password", setPassword);
router.post("/exchange", exchange);
router.post("/refresh-token", refreshToken);

// Protected routes
router.get("/profile", authenticate, getProfile);
router.get("/me", authenticate, getProfile);
router.put("/change-password", authenticate, changePassword);
// Self-service onboarding (fills the caller's own employee record).
router.get("/my-profile", authenticate, getMyProfile);
router.post("/complete-profile", authenticate, completeProfile);
// Self-service onboarding documents (location-driven).
router.get("/documents", authenticate, listDocuments);
router.post("/documents", authenticate, uploadSingle, uploadDocument);
router.delete("/documents/:type", authenticate, deleteDocument);

export default router;
