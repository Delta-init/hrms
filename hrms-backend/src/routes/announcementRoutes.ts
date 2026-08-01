import { Router } from "express";
import {
  createAnnouncement, getAnnouncements, getAnnouncementById, updateAnnouncement, deleteAnnouncement,
} from "../controllers/announcementController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

router.get("/", checkPermission("announcements", "view"), getAnnouncements);
router.post("/", checkPermission("announcements", "create"), createAnnouncement);
router.get("/:id", checkPermission("announcements", "view"), getAnnouncementById);
router.put("/:id", checkPermission("announcements", "edit"), updateAnnouncement);
router.delete("/:id", checkPermission("announcements", "delete"), deleteAnnouncement);

export default router;
