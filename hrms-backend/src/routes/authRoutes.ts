import { Router } from "express";
import {
  login,
  setPassword,
  exchange,
  refreshToken,
  getProfile,
  changePassword,
} from "../controllers/authController.js";
import { authenticate } from "../middleware/auth.js";

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

export default router;
