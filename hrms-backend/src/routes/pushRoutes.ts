import { Router } from "express";
import { getVapidPublicKey, subscribePush, unsubscribePush } from "../controllers/pushController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();
router.use(authenticate);

router.get("/vapid-public-key", getVapidPublicKey);
router.post("/subscribe", subscribePush);
router.delete("/unsubscribe", unsubscribePush);

export default router;
