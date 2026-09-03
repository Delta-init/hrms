import mongoose from "mongoose";
import { EJSON } from "bson";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { Backup } from "../models/Backup.js";
import { putObject, deleteObject, getObjectBuffer } from "./uploadService.js";

/**
 * Backing the whole database up, and putting a piece of it back.
 *
 * Read through the driver rather than by shelling out to `mongodump`. The tool
 * is not installed on the server this runs on, and a backup that depends on a
 * binary the application cannot verify is one that stops working silently — the
 * failure appears months later, when somebody needs the archive that was never
 * written. The database is 5 MB across 63 collections, which fits in memory
 * comfortably enough that the simpler route is also the correct one.
 *
 * Stored as Extended JSON, not plain JSON. `JSON.stringify` turns an ObjectId
 * into a string and a Date into text, so a restore would put back documents
 * that look right and match nothing — every reference silently broken. EJSON
 * round-trips both.
 */

/** Kept out of the archive: rebuilt on connect, and enormous next to the data. */
const SKIP = new Set(["system.profile", "system.views"]);

/** Thirty days of dailies. Older archives are deleted with their record. */
export const RETENTION_DAYS = 30;

export interface CollectionEntry {
  name: string;
  documents: number;
  bytes: number;
  status: "included" | "skipped" | "failed";
  reason: string;
}

const err = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

export class BackupService {
  /**
   * Dump every collection into one zip and store it.
   *
   * Every collection the database reports is attempted, and each result is
   * recorded whether it worked or not. A collection that could not be read is
   * listed as failed with the reason rather than quietly left out — the whole
   * value of the manifest is that "63 of 63" can be checked at a glance, and
   * that a missing one has somewhere to say so.
   */
  async run(trigger: "scheduled" | "manual", triggeredBy?: string) {
    const started = Date.now();
    const record = await Backup.create({ trigger, triggeredBy: triggeredBy ?? null, status: "running" });

    try {
      const db = mongoose.connection.db;
      if (!db) throw err("No database connection", 503);

      const all = await db.listCollections().toArray();
      const files: Record<string, Uint8Array> = {};
      const entries: CollectionEntry[] = [];

      for (const c of all) {
        const name = c.name;
        if (SKIP.has(name) || c.type === "view") {
          entries.push({ name, documents: 0, bytes: 0, status: "skipped", reason: c.type === "view" ? "a view, not stored data" : "internal collection" });
          continue;
        }
        try {
          const docs = await db.collection(name).find({}).toArray();
          const json = EJSON.stringify(docs, { relaxed: false });
          const bytes = strToU8(json);
          files[`collections/${name}.json`] = bytes;
          entries.push({ name, documents: docs.length, bytes: bytes.length, status: "included", reason: "" });
        } catch (e) {
          // Recorded, not thrown: one unreadable collection should not cost the
          // other sixty-two, and the manifest is where that is said out loud.
          entries.push({ name, documents: 0, bytes: 0, status: "failed", reason: e instanceof Error ? e.message : "unreadable" });
        }
      }

      const totals = {
        collections: entries.length,
        included: entries.filter((e) => e.status === "included").length,
        skipped: entries.filter((e) => e.status === "skipped").length,
        failed: entries.filter((e) => e.status === "failed").length,
        documents: entries.reduce((n, e) => n + e.documents, 0),
      };

      // The manifest rides inside the archive as well as being stored on the
      // record, so a downloaded zip explains itself without this system.
      const manifest = {
        createdAt: new Date().toISOString(),
        database: db.databaseName,
        format: "mongodb-extended-json-v2",
        note: "One file per collection under collections/. Restore with the Backups page, or mongoimport.",
        totals,
        collections: entries,
      };
      files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `hrms-backup-${stamp}.zip`;
      // Level 6: the archive is text, which compresses hard, and the difference
      // between 6 and 9 here is a second of CPU for a few kilobytes.
      const zipped = zipSync(files, { level: 6 });
      const key = `backups/${filename}`;
      await putObject(key, Buffer.from(zipped), "application/zip");

      Object.assign(record, {
        key, filename, bytes: zipped.length, status: "complete",
        collections: entries, totals,
        durationMs: Date.now() - started, finishedAt: new Date(),
      });
      await record.save();
      return record.toObject();
    } catch (e) {
      record.status = "failed";
      record.error = e instanceof Error ? e.message : String(e);
      record.durationMs = Date.now() - started;
      record.finishedAt = new Date();
      await record.save();
      throw e;
    }
  }

  async list(limit = 60) {
    return Backup.find({}).sort({ startedAt: -1 }).limit(limit).populate("triggeredBy", "name").lean();
  }

  async getById(id: string) {
    const record = await Backup.findById(id).populate("triggeredBy", "name").lean();
    if (!record) throw err("Backup not found", 404);
    return record;
  }

  /** The archive itself, for the download. */
  async archive(id: string): Promise<{ filename: string; body: Buffer }> {
    const record = await Backup.findById(id).lean();
    if (!record?.key) throw err("That backup has no archive", 404);
    const body = await getObjectBuffer(String(record.key));
    if (!body) throw err("The archive is no longer in storage", 410);
    return { filename: String(record.filename || "backup.zip"), body };
  }

  /**
   * What one collection in an archive holds, without changing anything.
   *
   * Restore is the most destructive thing this application can do, so it is
   * split in two: this half answers "what is in there and how does it differ
   * from what we have", and nothing is written until somebody has seen it.
   */
  async preview(id: string, collection: string) {
    const docs = await this.readCollection(id, collection);
    const db = mongoose.connection.db;
    if (!db) throw err("No database connection", 503);

    const live = await db.collection(collection).countDocuments();
    const ids = docs.map((d) => (d as { _id?: unknown })._id).filter(Boolean);
    const existing = ids.length ? await db.collection(collection).countDocuments({ _id: { $in: ids as never[] } }) : 0;

    return {
      collection,
      inArchive: docs.length,
      liveNow: live,
      /** Already present, and would be overwritten. */
      wouldReplace: existing,
      /** Gone from the live database, and would come back. */
      wouldRestore: docs.length - existing,
      /** Live rows the archive does not mention. Never touched — see restore. */
      untouched: live - existing,
      sample: docs.slice(0, 3),
    };
  }

  /**
   * Put one collection's documents back.
   *
   * Additive by construction: each document is written by its own `_id`, and
   * live documents the archive does not mention are left exactly as they are.
   * Nothing is dropped, nothing is emptied. A restore that cleared the
   * collection first would turn "bring back the rows we lost" into "discard
   * everything since the backup", which is the same button doing the opposite
   * of what somebody pressed it for.
   */
  async restore(id: string, collection: string, only?: string[]) {
    const all = await this.readCollection(id, collection);
    const db = mongoose.connection.db;
    if (!db) throw err("No database connection", 503);

    const wanted = only?.length ? new Set(only.map(String)) : null;
    const docs = wanted ? all.filter((d) => wanted.has(String((d as { _id?: unknown })._id))) : all;
    if (!docs.length) throw err("Nothing in that archive matched", 400);

    let replaced = 0, inserted = 0;
    for (const doc of docs) {
      const _id = (doc as { _id?: unknown })._id;
      if (!_id) continue;
      const had = await db.collection(collection).countDocuments({ _id: _id as never });
      await db.collection(collection).replaceOne({ _id: _id as never }, doc as never, { upsert: true });
      had ? replaced++ : inserted++;
    }
    return { collection, restored: docs.length, replaced, inserted };
  }

  /** One collection's documents out of an archive, parsed back into BSON types. */
  private async readCollection(id: string, collection: string): Promise<unknown[]> {
    const record = await Backup.findById(id).lean();
    if (!record?.key) throw err("Backup not found", 404);
    const body = await getObjectBuffer(String(record.key));
    if (!body) throw err("The archive is no longer in storage", 410);

    const unzipped = unzipSync(new Uint8Array(body));
    const file = unzipped[`collections/${collection}.json`];
    if (!file) throw err(`"${collection}" is not in that archive`, 404);
    // Strict EJSON, so an ObjectId comes back an ObjectId rather than a string
    // that matches nothing.
    return EJSON.parse(strFromU8(file), { relaxed: false }) as unknown[];
  }

  /**
   * Drop archives past the retention window.
   *
   * The record goes with the object. A row pointing at an archive that is no
   * longer in storage is worse than no row: it reads as a backup somebody could
   * restore from, right up until they try.
   */
  async prune(days = RETENTION_DAYS) {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const old = await Backup.find({ startedAt: { $lt: cutoff } }).select("_id key").lean();
    for (const b of old) {
      if (b.key) await deleteObject(String(b.key));
      await Backup.deleteOne({ _id: b._id });
    }
    return { removed: old.length };
  }
}
