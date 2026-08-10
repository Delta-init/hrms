import crypto from "node:crypto";
import { env } from "../config/env.js";
import { LivenessChallenge } from "../models/LivenessChallenge.js";
import type { IKiosk, ILivenessChallenge, LivenessStep } from "../types/index.js";

const TTL_MS = (Number(env.FACE_LIVENESS_TTL_SECONDS) || 30) * 1000;

export const livenessRequired = env.FACE_LIVENESS_MODE === "required";

/**
 * The sequences a kiosk can ask for.
 *
 * Deliberately short: every prompt is another frame to upload and another
 * second of inference, and a person at a door will not perform a routine. The
 * value is not in the length but in the server picking, so a recording made in
 * advance has to guess which one it will be asked to perform.
 *
 * Four options is not a large number, and it is not pretending to be — this
 * stops photographs and static screens outright, and makes casual video replay
 * mostly fail. A determined video attack is what the pluggable spoof model in
 * the recognition service is for.
 */
const SEQUENCES: LivenessStep[][] = [
  ["center", "left", "right"],
  ["center", "right", "left"],
  ["center", "left"],
  ["center", "right"],
];

export interface IssuedChallenge {
  id: string;
  steps: LivenessStep[];
  expiresAt: Date;
}

export class LivenessError extends Error {
  statusCode = 400;
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "LivenessError";
    this.code = code;
  }
}

export class LivenessService {
  /** Hand a device a fresh sequence to ask for. */
  async issue(kiosk: IKiosk): Promise<IssuedChallenge> {
    // crypto rather than Math.random: this is the only thing an attacker has to
    // guess, and a predictable sequence would let them prepare for it.
    const steps = SEQUENCES[crypto.randomInt(SEQUENCES.length)]!;
    const expiresAt = new Date(Date.now() + TTL_MS);

    const challenge = await LivenessChallenge.create({
      organization: kiosk.organization ?? null,
      kiosk: kiosk._id,
      steps,
      expiresAt,
    });

    return { id: String(challenge._id), steps, expiresAt };
  }

  /**
   * Redeem a challenge, returning the steps it asked for.
   *
   * Marked consumed here, before the frames are looked at, so a failed attempt
   * burns it. Otherwise somebody could keep feeding frames against one set of
   * prompts until a lucky one got through.
   */
  async consume(challengeId: string, kiosk: IKiosk): Promise<LivenessStep[]> {
    if (!/^[a-f\d]{24}$/i.test(challengeId)) {
      throw new LivenessError("Start again from the beginning.", "CHALLENGE_INVALID");
    }

    const challenge = (await LivenessChallenge.findOneAndUpdate(
      { _id: challengeId, kiosk: kiosk._id, consumedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { consumedAt: new Date() } },
      { new: true }
    )) as ILivenessChallenge | null;

    if (!challenge) {
      // Expired, already used, or issued to a different device — all of which
      // the person in front of the kiosk fixes the same way.
      throw new LivenessError("That took too long. Try again.", "CHALLENGE_EXPIRED");
    }

    return challenge.steps;
  }
}
