import { Router } from "express";
import {
  getMyFirstDays, confirmMySession, answerMyHomework, submitMyRolePlay, submitMyCallNotes, myCallsDone, startMyTeamVideo, myTeamVideoBeat,
  startMyHomeworkVideo, myHomeworkVideoBeat, submitMyWriteUp,
  getTeamFirstDays, confirmSessionAsHead, addHomework, setHomeworkQuestion, addHomeworkToMany, setToolAccess, assignClients, getTeamVideo, uploadTeamVideo,
  addVideoHomework, setHomeworkVideo, addVideoHomeworkToMany,
  listVimeoVideos, addVimeoHomework, setHomeworkVimeo, addVimeoHomeworkToMany,
  addMyExtraVideo, addMyExtraLink, myExtraVideo, myExtraLink, giveExtraFeedback,
} from "../controllers/firstDaysController.js";
import { authenticate } from "../middleware/auth.js";
import { uploadClipSingle, uploadDocumentSingle, uploadVideoSingle } from "../middleware/upload.js";

/**
 * A new joiner's first days. No module permission on any route: the joiner,
 * their department head and HR each reach their own part, and the service
 * checks which of the three the caller is.
 */
const router = Router();
router.use(authenticate);

router.get("/mine", getMyFirstDays);
router.post("/mine/session", confirmMySession);
router.post("/mine/homework/:itemId", uploadDocumentSingle, answerMyHomework);
router.post("/mine/homework/:itemId/video/start", startMyHomeworkVideo);
router.post("/mine/homework/:itemId/video/beat", myHomeworkVideoBeat);
router.post("/mine/homework/:itemId/write-up", uploadDocumentSingle, submitMyWriteUp);
// Additional homework: the joiner's own presentation videos.
router.post("/mine/extras/video", uploadClipSingle, addMyExtraVideo);
router.post("/mine/extras/link", addMyExtraLink);
router.post("/mine/extras/:extraId/video", uploadClipSingle, myExtraVideo);
router.post("/mine/extras/:extraId/link", myExtraLink);
router.post("/mine/role-play", submitMyRolePlay);
router.post("/mine/call-notes", submitMyCallNotes);
router.post("/mine/calls", myCallsDone);
router.post("/mine/team-video/start", startMyTeamVideo);
router.post("/mine/team-video/beat", myTeamVideoBeat);

router.get("/team", getTeamFirstDays);
// Several joiners at once — each still checked as if sent on its own.
router.post("/homework/many", uploadDocumentSingle, addHomeworkToMany);
router.post("/homework/many/video", uploadVideoSingle, addVideoHomeworkToMany);
router.post("/homework/many/vimeo", addVimeoHomeworkToMany);
router.get("/vimeo/videos", listVimeoVideos);
router.get("/team-video/:departmentId", getTeamVideo);
router.post("/team-video/:departmentId", uploadVideoSingle, uploadTeamVideo);

router.post("/:employeeId/session", confirmSessionAsHead);
router.post("/:employeeId/homework", uploadDocumentSingle, addHomework);
router.post("/:employeeId/homework/video", uploadVideoSingle, addVideoHomework);
router.post("/:employeeId/homework/vimeo", addVimeoHomework);
router.post("/:employeeId/homework/:itemId/question", uploadDocumentSingle, setHomeworkQuestion);
router.post("/:employeeId/homework/:itemId/video", uploadVideoSingle, setHomeworkVideo);
router.post("/:employeeId/homework/:itemId/vimeo", setHomeworkVimeo);
router.post("/:employeeId/access", setToolAccess);
router.post("/:employeeId/clients", assignClients);
router.post("/:employeeId/extras/:extraId/feedback", giveExtraFeedback);

export default router;
