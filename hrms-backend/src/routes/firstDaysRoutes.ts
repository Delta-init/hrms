import { Router } from "express";
import {
  getMyFirstDays, confirmMySession, answerMyHomework, submitMyRolePlay, submitMyCallNotes, myCallsDone, startMyTeamVideo, myTeamVideoBeat,
  startMyHomeworkVideo, myHomeworkVideoBeat, submitMyWriteUp,
  getTeamFirstDays, confirmSessionAsHead, addHomework, setHomeworkQuestion, addHomeworkToMany, setToolAccess, assignClients, getTeamVideo, uploadTeamVideo,
  addVideoHomework, setHomeworkVideo, addVideoHomeworkToMany,
  listVimeoVideos, addVimeoHomework, setHomeworkVimeo, addVimeoHomeworkToMany,
  addMyExtraFile, addMyExtraLink, addToMyExtraFile, addToMyExtraLink, removeFromMyExtra, moveMyExtra, giveExtraFeedback,
  removeMyAnswerFile, addHomeworkFiles, removeHomeworkFile, moveHomework,
} from "../controllers/firstDaysController.js";
import { authenticate } from "../middleware/auth.js";
import { uploadDocumentArray, uploadDocumentSingle, uploadExtraSingle, uploadVideoSingle } from "../middleware/upload.js";

/**
 * A new joiner's first days. No module permission on any route: the joiner,
 * their department head and HR each reach their own part, and the service
 * checks which of the three the caller is.
 */
const router = Router();
router.use(authenticate);

router.get("/mine", getMyFirstDays);
router.post("/mine/session", confirmMySession);
router.post("/mine/homework/:itemId", uploadDocumentArray, answerMyHomework);
router.post("/mine/homework/:itemId/files/remove", removeMyAnswerFile);
router.post("/mine/homework/:itemId/video/start", startMyHomeworkVideo);
router.post("/mine/homework/:itemId/video/beat", myHomeworkVideoBeat);
router.post("/mine/homework/:itemId/write-up", uploadDocumentArray, submitMyWriteUp);
// Additional homework: the joiner's own presentation videos, slides and links.
router.post("/mine/extras/file", uploadExtraSingle, addMyExtraFile);
router.post("/mine/extras/link", addMyExtraLink);
router.post("/mine/extras/:extraId/file", uploadExtraSingle, addToMyExtraFile);
router.post("/mine/extras/:extraId/link", addToMyExtraLink);
router.post("/mine/extras/:extraId/remove", removeFromMyExtra);
router.post("/mine/extras/:extraId/folder", moveMyExtra);
router.post("/mine/role-play", submitMyRolePlay);
router.post("/mine/call-notes", submitMyCallNotes);
router.post("/mine/calls", myCallsDone);
router.post("/mine/team-video/start", startMyTeamVideo);
router.post("/mine/team-video/beat", myTeamVideoBeat);

router.get("/team", getTeamFirstDays);
// Several joiners at once — each still checked as if sent on its own.
router.post("/homework/many", uploadDocumentArray, addHomeworkToMany);
router.post("/homework/many/video", uploadVideoSingle, addVideoHomeworkToMany);
router.post("/homework/many/vimeo", addVimeoHomeworkToMany);
router.get("/vimeo/videos", listVimeoVideos);
router.get("/team-video/:departmentId", getTeamVideo);
router.post("/team-video/:departmentId", uploadVideoSingle, uploadTeamVideo);

router.post("/:employeeId/session", confirmSessionAsHead);
router.post("/:employeeId/homework", uploadDocumentArray, addHomework);
router.post("/:employeeId/homework/video", uploadVideoSingle, addVideoHomework);
router.post("/:employeeId/homework/vimeo", addVimeoHomework);
router.post("/:employeeId/homework/:itemId/question", uploadDocumentSingle, setHomeworkQuestion);
router.post("/:employeeId/homework/:itemId/files", uploadDocumentArray, addHomeworkFiles);
router.post("/:employeeId/homework/:itemId/files/remove", removeHomeworkFile);
router.post("/:employeeId/homework/:itemId/folder", moveHomework);
router.post("/:employeeId/homework/:itemId/video", uploadVideoSingle, setHomeworkVideo);
router.post("/:employeeId/homework/:itemId/vimeo", setHomeworkVimeo);
router.post("/:employeeId/access", setToolAccess);
router.post("/:employeeId/clients", assignClients);
router.post("/:employeeId/extras/:extraId/feedback", giveExtraFeedback);

export default router;
