import { Router } from "express";
import {
  login,
  setPassword,
  exchange,
  refreshToken,
  getProfile,
  changePassword,
  logout,
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
import { authLimiter, tokenLimiter } from "../middleware/rateLimit.js";

const router = Router();

// Public routes — rate limited, since none of them require a session.
router.post("/login", authLimiter, login);
router.post("/set-password", authLimiter, setPassword);
router.post("/exchange", tokenLimiter, exchange);
router.post("/refresh-token", tokenLimiter, refreshToken);

// Protected routes
router.get("/profile", authenticate, getProfile);
router.get("/me", authenticate, getProfile);
router.put("/change-password", authenticate, changePassword);
router.post("/logout", authenticate, logout);
// Self-service onboarding (fills the caller's own employee record).
router.get("/my-profile", authenticate, getMyProfile);
router.post("/complete-profile", authenticate, completeProfile);
// Self-service onboarding documents (location-driven).
router.get("/documents", authenticate, listDocuments);
router.post("/documents", authenticate, uploadSingle, uploadDocument);
router.delete("/documents/:type", authenticate, deleteDocument);

export default router;
