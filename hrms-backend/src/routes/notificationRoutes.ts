import { Router } from "express";
import {
  getNotifications, getUnreadCount, readNotification, readAllNotifications,
} from "../controllers/notificationController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// No `checkPermission`: every route here is about the caller's own
// notifications, and the recipient filter in the service is the gate. A module
// permission would be the wrong shape — it would either lock somebody out of
// their own bell or let them read somebody else's.
router.use(authenticate);

router.get("/", getNotifications);
// Before "/:id" would matter if there were one; kept above regardless so the
// order stays right when a detail route is added.
router.get("/unread-count", getUnreadCount);
router.post("/read-all", readAllNotifications);
router.patch("/:id/read", readNotification);

export default router;
