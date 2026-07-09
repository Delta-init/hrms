import { Router } from "express";
import {
  createCard, getCards, getCardById, updateCard, deleteCard,
} from "../controllers/cardController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

router.get("/", checkPermission("cards", "view"), getCards);
router.post("/", checkPermission("cards", "create"), createCard);
router.get("/:id", checkPermission("cards", "view"), getCardById);
router.put("/:id", checkPermission("cards", "edit"), updateCard);
router.delete("/:id", checkPermission("cards", "delete"), deleteCard);

export default router;
