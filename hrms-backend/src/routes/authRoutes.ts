import { Router } from "express";
import {
  login,
  ssoLogin,
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
  listMyOtherDocs,
  addMyOtherDoc,
  updateMyOtherDoc,
  deleteMyOtherDoc,
} from "../controllers/documentController.js";
import { getMyOnboardingForm } from "../controllers/onboardingFormController.js";
import { authenticate } from "../middleware/auth.js";
import { uploadSingle } from "../middleware/upload.js";
import { authLimiter, tokenLimiter } from "../middleware/rateLimit.js";

const router = Router();

// Public routes — rate limited, since none of them require a session.
router.post("/login", authLimiter, login);
// Rate limited like a login, because that is what it is — the credential is
// just a one-time token from the portal rather than a password.
router.post("/sso-login", authLimiter, ssoLogin);
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
// Self-service: free-form documents beyond the fixed slots above.
router.get("/other-documents", authenticate, listMyOtherDocs);
router.post("/other-documents", authenticate, uploadSingle, addMyOtherDoc);
router.put("/other-documents/:recordId", authenticate, uploadSingle, updateMyOtherDoc);
router.delete("/other-documents/:recordId", authenticate, deleteMyOtherDoc);
// Self-service: the filled joining form, generated from whatever the
// employee record already holds. Nothing to upload — this only reads.
router.get("/onboarding-form", authenticate, getMyOnboardingForm);

export default router;
