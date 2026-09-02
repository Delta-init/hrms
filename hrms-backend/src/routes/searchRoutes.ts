import { Router } from "express";
import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { globalSearch } from "../services/globalSearchService.js";
import { authenticate } from "../middleware/auth.js";
import { sendSuccess } from "../utils/response.js";

const router = Router();

// No `checkPermission`: each source inside carries its own, because one gate
// for all of them would have to be as permissive as the most open source and
// would then leak the strictest.
router.use(authenticate);

router.get("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    sendSuccess(res, "Search results", await globalSearch(q, req.user?.role));
  } catch (error) { next(error); }
});

export default router;
