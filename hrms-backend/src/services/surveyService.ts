import { Survey } from "../models/Survey.js";
import { SurveyResponse } from "../models/SurveyResponse.js";
import type {
  CreateSurveyInput, UpdateSurveyInput, SetSurveyStatusInput, SubmitSurveyResponseInput,
} from "../validations/surveyValidation.js";
import type { ISurveyQuestion } from "../types/index.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";

const POP = [{ path: "createdBy", select: "name" }];

export class SurveyService {
  // ── Admin ──────────────────────────────────────────────────────────────
  async create(input: CreateSurveyInput, createdBy: string) {
    const doc = await Survey.create({ ...input, organization: getOrgId(), createdBy });
    return Survey.findById(doc._id).populate(POP);
  }

  async list() {
    const surveys = await Survey.find(orgFilter()).populate(POP).sort({ createdAt: -1 }).lean();
    const counts = await SurveyResponse.aggregate([
      { $match: { survey: { $in: surveys.map((s) => s._id) } } },
      { $group: { _id: "$survey", count: { $sum: 1 } } },
    ]);
    const countBySurvey = new Map(counts.map((c) => [String(c._id), c.count]));
    return surveys.map((s) => ({ ...s, responseCount: countBySurvey.get(String(s._id)) ?? 0 }));
  }

  async getById(id: string) {
    const record = await Survey.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Survey not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateSurveyInput) {
    const record = await Survey.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Survey not found"), { statusCode: 404 });
    if (record.status !== "draft") {
      throw Object.assign(new Error("Only draft surveys can be edited — close it and create a new one instead"), { statusCode: 400 });
    }
    Object.assign(record, {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.questions !== undefined && { questions: input.questions }),
      ...(input.closesAt !== undefined && { closesAt: input.closesAt }),
    });
    await record.save();
    return Survey.findById(id).populate(POP);
  }

  async setStatus(id: string, input: SetSurveyStatusInput) {
    const record = await Survey.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Survey not found"), { statusCode: 404 });
    if (record.status === "closed") throw Object.assign(new Error("Closed surveys cannot be reopened"), { statusCode: 400 });
    if (input.status === "active" && record.questions.length === 0) {
      throw Object.assign(new Error("Add at least one question before activating this survey"), { statusCode: 400 });
    }
    record.status = input.status;
    await record.save();
    return Survey.findById(id).populate(POP);
  }

  async remove(id: string) {
    const record = await Survey.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Survey not found"), { statusCode: 404 });
    await SurveyResponse.deleteMany({ survey: record._id });
    return { message: "Survey deleted successfully" };
  }

  async getResults(id: string) {
    const survey = await Survey.findOne(scoped({ _id: id })).populate(POP);
    if (!survey) throw Object.assign(new Error("Survey not found"), { statusCode: 404 });
    const responses = await SurveyResponse.find(scoped({ survey: survey._id }));

    const questions = survey.questions.map((q: ISurveyQuestion) => {
      const answers = responses
        .map((r) => r.answers.find((a) => String(a.question) === String(q._id)))
        .filter((a): a is NonNullable<typeof a> => !!a);

      if (q.type === "rating") {
        const values = answers.map((a) => Number(a.value)).filter((v) => !Number.isNaN(v));
        const average = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
        const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        for (const v of values) if (distribution[v] !== undefined) distribution[v]++;
        return { questionId: q._id, text: q.text, type: q.type, responseCount: values.length, average: Math.round(average * 100) / 100, distribution };
      }
      if (q.type === "single_choice") {
        const counts: Record<string, number> = Object.fromEntries(q.options.map((o) => [o, 0]));
        for (const a of answers) if (counts[String(a.value)] !== undefined) counts[String(a.value)]++;
        return { questionId: q._id, text: q.text, type: q.type, responseCount: answers.length, counts };
      }
      return { questionId: q._id, text: q.text, type: q.type, responseCount: answers.length, textAnswers: answers.map((a) => String(a.value)) };
    });

    return { survey, totalResponses: responses.length, questions };
  }

  // ── Self-service ───────────────────────────────────────────────────────
  async listMine(userId: string) {
    const surveys = await Survey.find(scoped({ status: "active" })).sort({ createdAt: -1 }).lean();
    const responded = await SurveyResponse.find({ user: userId, survey: { $in: surveys.map((s) => s._id) } }).select("survey").lean();
    const respondedIds = new Set(responded.map((r) => String(r.survey)));
    return surveys.map((s) => ({ ...s, hasResponded: respondedIds.has(String(s._id)) }));
  }

  async submitResponse(userId: string, surveyId: string, input: SubmitSurveyResponseInput) {
    const survey = await Survey.findOne(scoped({ _id: surveyId }));
    if (!survey) throw Object.assign(new Error("Survey not found"), { statusCode: 404 });
    if (survey.status !== "active") throw Object.assign(new Error("This survey is not currently accepting responses"), { statusCode: 400 });

    const existing = await SurveyResponse.findOne({ survey: survey._id, user: userId });
    if (existing) throw Object.assign(new Error("You have already responded to this survey"), { statusCode: 409 });

    const byId = new Map(survey.questions.map((q) => [String(q._id), q]));
    for (const q of survey.questions) {
      if (!q.required) continue;
      const answered = input.answers.some((a) => a.question === String(q._id));
      if (!answered) throw Object.assign(new Error(`"${q.text}" is required`), { statusCode: 400 });
    }
    for (const a of input.answers) {
      const q = byId.get(a.question);
      if (!q) throw Object.assign(new Error("Unknown question in submission"), { statusCode: 400 });
      if (q.type === "single_choice" && !q.options.includes(String(a.value))) {
        throw Object.assign(new Error(`"${a.value}" is not a valid option for "${q.text}"`), { statusCode: 400 });
      }
      if (q.type === "rating") {
        const n = Number(a.value);
        if (Number.isNaN(n) || n < 1 || n > 5) throw Object.assign(new Error(`"${q.text}" must be rated 1–5`), { statusCode: 400 });
      }
    }

    return SurveyResponse.create({
      organization: getOrgId(),
      survey: survey._id,
      user: userId,
      answers: input.answers,
    });
  }
}
