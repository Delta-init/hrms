import { Router } from "express";
import {
  getRooms, createRoom, updateRoom, retireRoom,
  getInvitable, getBookings, getBookingById, createBooking, updateBooking, cancelBooking, deleteBooking,
} from "../controllers/meetingController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

/**
 * Editing and cancelling are gated on `create`, not on `edit`.
 *
 * Whoever may book a room must be able to change their own booking, and most
 * of them hold nothing more than view and create. Who may touch *somebody
 * else's* is decided in the service, where the organiser, any department head
 * and Super Admin are the three answers — a route permission cannot express
 * "your own", and pretending it can is how people end up unable to cancel the
 * meeting they just arranged.
 */
const router = Router();
router.use(authenticate);

router.get("/rooms", checkPermission("meetings", "view"), getRooms);
router.post("/rooms", checkPermission("meetings", "edit"), createRoom);
router.put("/rooms/:id", checkPermission("meetings", "edit"), updateRoom);
router.patch("/rooms/:id/retire", checkPermission("meetings", "edit"), retireRoom);

router.get("/invitable", checkPermission("meetings", "create"), getInvitable);
router.get("/bookings", checkPermission("meetings", "view"), getBookings);
router.post("/bookings", checkPermission("meetings", "create"), createBooking);
router.get("/bookings/:id", checkPermission("meetings", "view"), getBookingById);
router.put("/bookings/:id", checkPermission("meetings", "create"), updateBooking);
router.patch("/bookings/:id/cancel", checkPermission("meetings", "create"), cancelBooking);
router.delete("/bookings/:id", checkPermission("meetings", "create"), deleteBooking);

export default router;
