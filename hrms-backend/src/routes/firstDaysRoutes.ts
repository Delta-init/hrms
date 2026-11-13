import { Router } from "express";
import {
  getMyFirstDays, confirmMySession, handInMyHomework, submitMyRolePlay, submitMyCallNotes, myCallsDone, startMyTeamVideo, myTeamVideoBeat,
  getTeamFirstDays, confirmSessionAsHead, sendHomework, sendHomeworkToMany, setToolAccess, assignClients, getTeamVideo, uploadTeamVideo,
} from "../controllers/firstDaysController.js";
import { authenticate } from "../middleware/auth.js";
import { uploadDocumentSingle, uploadVideoSingle } from "../middleware/upload.js";

/**
 * A new joiner's first days. No module permission on any route: the joiner,
 * their department head and HR each reach their own part, and the service
 * checks which of the three the caller is.
 */
const router = Router();
router.use(authenticate);

router.get("/mine", getMyFirstDays);
router.post("/mine/session", confirmMySession);
router.post("/mine/homework", uploadDocumentSingle, handInMyHomework);
router.post("/mine/role-play", submitMyRolePlay);
router.post("/mine/call-notes", submitMyCallNotes);
router.post("/mine/calls", myCallsDone);
router.post("/mine/team-video/start", startMyTeamVideo);
router.post("/mine/team-video/beat", myTeamVideoBeat);

router.get("/team", getTeamFirstDays);
// Several joiners at once — each still checked as if sent on its own.
router.post("/homework/many", uploadDocumentSingle, sendHomeworkToMany);
router.get("/team-video/:departmentId", getTeamVideo);
router.post("/team-video/:departmentId", uploadVideoSingle, uploadTeamVideo);

router.post("/:employeeId/session", confirmSessionAsHead);
router.post("/:employeeId/homework", uploadDocumentSingle, sendHomework);
router.post("/:employeeId/access", setToolAccess);
router.post("/:employeeId/clients", assignClients);

export default router;
