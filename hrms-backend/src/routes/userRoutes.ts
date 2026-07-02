import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import {
  createUser,
  getUsers,
  getUserById,
  getUserProfile,
  updateUser,
  deleteUser,
  impersonateUser,
} from "../controllers/userController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();

// All user routes require authentication
router.use(authenticate);

/** Allow a user to access their own record without needing users.view permission */
function selfOrPermission(req: Request, res: Response, next: NextFunction) {
  const authReq = req as AuthenticatedRequest;
  if (authReq.user?.userId === req.params.id) return next();
  return checkPermission("users", "view")(req, res, next);
}

router.get("/", checkPermission("users", "view"), getUsers);
router.post("/", checkPermission("users", "create"), createUser);
// /profile must come before /:id
router.get("/profile", getUserProfile);
router.get("/:id", selfOrPermission, getUserById);
router.put("/:id", checkPermission("users", "edit"), updateUser);
router.delete("/:id", checkPermission("users", "delete"), deleteUser);
// Impersonate: issue a short-lived ticket to log in as this user
router.post("/:id/impersonate", checkPermission("users", "edit"), impersonateUser);

export default router;
