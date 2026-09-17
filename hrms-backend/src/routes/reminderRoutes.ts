import { Router } from "express";
import { createReminder, listMyReminders, cancelReminder } from "../controllers/reminderController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();
router.use(authenticate);

// Self-service, same as leave/programs — no module permission required.
// "everyone" audience is checked inside the controller instead, since it
// depends on the request body rather than the route.
router.get("/mine", listMyReminders);
router.post("/", createReminder);
router.delete("/:id", cancelReminder);

export default router;
