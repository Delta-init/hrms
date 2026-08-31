import "dotenv/config"; import mongoose from "mongoose";
import { Organization } from "../models/Organization.js";
import { Employee } from "../models/Employee.js"; import { User } from "../models/User.js";
import { Role } from "../models/Role.js";
import { DocumentTemplate } from "../models/DocumentTemplate.js";
import { InductionVideo } from "../models/InductionVideo.js";
const DOWN = process.argv.includes("--down");
await mongoose.connect(process.env.MONGODB_URI!);
const test = await Organization.findOne({ name: "test" });
const prod = await Organization.findOne({ name: "Delta International Management Development Training" }).lean();
const EMAIL = "gate-check@local.test";
if (DOWN) {
  const u = await User.findOne({ email: EMAIL });
  if (u) await Employee.deleteMany({ user: u._id });
  await User.deleteOne({ email: EMAIL });
  await Role.deleteMany({ organization: test!._id, roleName: "Gate Check" });
  await DocumentTemplate.deleteMany({ organization: test!._id });
  await InductionVideo.deleteMany({ organization: test!._id });
  await Organization.updateOne({ _id: test!._id }, { $unset: { "settings.requireAgreements": "", "settings.requireFaceEnrollment": "" } });
  console.log("  removed"); await mongoose.disconnect(); process.exit(0);
}
// Point at the objects already in the bucket — the signature is by key, and
// nothing here writes to R2.
const srcT = await DocumentTemplate.find({ organization: prod!._id, active: true }).lean();
const srcV = await InductionVideo.findOne({ organization: prod!._id, active: true }).lean() as any;
await DocumentTemplate.deleteMany({ organization: test!._id });
await InductionVideo.deleteMany({ organization: test!._id });
for (const t of srcT as any[])
  await DocumentTemplate.create({ organization: test!._id, kind: t.kind, variant: t.variant, version: 1,
    fileKey: t.fileKey, fileName: t.fileName, sha256: t.sha256, active: true });
await InductionVideo.create({ organization: test!._id, title: srcV.title, fileKey: srcV.fileKey,
  fileName: srcV.fileName, durationSeconds: srcV.durationSeconds, active: true });
await Organization.updateOne({ _id: test!._id }, { $set: { "settings.requireAgreements": true, "settings.requireFaceEnrollment": false } });

const role = await Role.findOneAndUpdate({ organization: test!._id, roleName: "Gate Check" },
  { roleName: "Gate Check", isSystemRole: false, organization: test!._id, permissions: { dashboard: { view: true } } },
  { upsert: true, new: true });
await User.deleteOne({ email: EMAIL });
const u = await User.create({ name: "Gate Check", email: EMAIL, password: "Password123!", role: role._id,
  organization: test!._id, status: "active", profileCompleted: true });
await Employee.deleteMany({ organization: test!._id, employeeCode: "GC01" });
await Employee.create({ organization: test!._id, employeeCode: "GC01", name: "Gate Check", user: u._id,
  status: "active", workMode: "office", location: "dubai" });
console.log(`  ${EMAIL} / Password123!  · ${srcT.length} templates, video ${srcV.durationSeconds}s, gate ON`);
await mongoose.disconnect();
