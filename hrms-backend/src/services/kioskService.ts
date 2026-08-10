import crypto from "node:crypto";
import { hashDeviceSecret } from "../middleware/kioskAuth.js";
import { Kiosk } from "../models/Kiosk.js";
import { orgFilter, getOrgId, scoped } from "../utils/orgContext.js";

export interface PairedKiosk {
  id: string;
  name: string;
  /**
   * The full device token. Returned exactly once, at pairing — only its hash is
   * stored, so a lost token means pairing the tablet again rather than looking
   * it up.
   */
  token: string;
}

export class KioskService {
  async list() {
    return Kiosk.find(orgFilter())
      .sort({ createdAt: -1 })
      .populate("createdBy", "name");
  }

  async register(input: { name: string; location?: string }, actorId: string): Promise<PairedKiosk> {
    const secret = crypto.randomBytes(32).toString("hex");
    const kiosk = await Kiosk.create({
      organization: getOrgId(),
      name: input.name,
      location: input.location,
      tokenHash: hashDeviceSecret(secret),
      tokenHint: secret.slice(-4),
      createdBy: actorId,
    });

    return { id: String(kiosk._id), name: kiosk.name, token: `${kiosk._id}.${secret}` };
  }

  /**
   * Issue a new secret for an existing device — for a tablet being re-imaged,
   * or one whose token may have been seen. The old token stops working the
   * moment this returns.
   */
  async rotate(id: string): Promise<PairedKiosk> {
    const secret = crypto.randomBytes(32).toString("hex");
    const kiosk = await Kiosk.findOneAndUpdate(
      scoped({ _id: id }),
      { $set: { tokenHash: hashDeviceSecret(secret), tokenHint: secret.slice(-4) } },
      { new: true }
    );
    if (!kiosk) throw Object.assign(new Error("Kiosk not found"), { statusCode: 404 });
    return { id: String(kiosk._id), name: kiosk.name, token: `${kiosk._id}.${secret}` };
  }

  async setActive(id: string, active: boolean) {
    const kiosk = await Kiosk.findOneAndUpdate(scoped({ _id: id }), { $set: { active } }, { new: true });
    if (!kiosk) throw Object.assign(new Error("Kiosk not found"), { statusCode: 404 });
    return kiosk;
  }

  async remove(id: string) {
    const kiosk = await Kiosk.findOneAndDelete(scoped({ _id: id }));
    if (!kiosk) throw Object.assign(new Error("Kiosk not found"), { statusCode: 404 });
  }
}
