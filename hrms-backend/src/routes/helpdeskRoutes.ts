import { Router } from "express";
import {
  createTicket, getTickets, getMyTickets, getTicketById, assignTicket, setTicketStatus,
  deleteTicket, addTicketComment,
} from "../controllers/helpdeskController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Self-service — own tickets, no module permission required.
router.get("/mine", getMyTickets);
// Comments: allowed for the ticket's owner, its assignee, or anyone with helpdesk.edit — checked in the service.
router.post("/:id/comments", addTicketComment);

router.get("/", checkPermission("helpdesk", "view"), getTickets);
router.post("/", checkPermission("helpdesk", "create"), createTicket);
router.get("/:id", checkPermission("helpdesk", "view"), getTicketById);
router.patch("/:id/assign", checkPermission("helpdesk", "edit"), assignTicket);
router.patch("/:id/status", checkPermission("helpdesk", "edit"), setTicketStatus);
router.delete("/:id", checkPermission("helpdesk", "delete"), deleteTicket);

export default router;
