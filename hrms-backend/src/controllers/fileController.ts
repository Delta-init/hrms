import type { Request, Response, NextFunction } from "express";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { r2, r2Enabled, R2_BUCKET } from "../config/r2.js";
import { verifyFileUrl } from "../utils/fileUrl.js";

/**
 * Serves a stored object to a browser holding a link this API signed.
 *
 * Deliberately not behind `authenticate`: the caller is an `<img>` or a
 * downloading tab, neither of which can send a bearer token. The signature and
 * its expiry are the credential, and they were only ever handed to somebody who
 * had already passed a permission check to see the record the link came with.
 *
 * With this in place the bucket itself should be private — while it still
 * answers on a public hostname, the old unsigned URLs keep working and none of
 * this helps.
 */
export const getFile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // The key is the whole remaining path, slashes and all.
    const key = decodeURIComponent(String(req.params[0] ?? ""));
    const { e: expiresAt, s: signature } = req.query as { e?: string; s?: string };

    if (!key || !expiresAt || !signature || !verifyFileUrl(key, expiresAt, signature)) {
      // One answer for a bad signature, an expired link and a key that is not
      // there, so this cannot be used to find out which objects exist.
      res.status(404).json({ success: false, message: "File not found or link expired" });
      return;
    }

    if (!r2Enabled || !r2) {
      res.status(503).json({ success: false, message: "File storage is not configured" });
      return;
    }

    /**
     * Range requests, passed straight through to R2.
     *
     * A <video> asks for byte ranges rather than the whole file, and answering
     * the whole thing with a 200 is not something every browser will play — the
     * induction video failed to load at all until this was here. Documents are
     * unaffected: without a Range header this behaves exactly as before.
     */
    const range = req.headers.range;
    const object = await r2.send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: key, ...(range ? { Range: range } : {}) })
    );

    res.setHeader("Content-Type", object.ContentType ?? "application/octet-stream");
    // Advertised even on a full response, or the player never asks in the first place.
    res.setHeader("Accept-Ranges", "bytes");
    if (object.ContentLength) res.setHeader("Content-Length", String(object.ContentLength));
    if (range && object.ContentRange) {
      res.status(206);
      res.setHeader("Content-Range", object.ContentRange);
    }
    // Cacheable for the life of the link and no longer, and private so shared
    // proxies never hold somebody's passport scan.
    res.setHeader("Cache-Control", "private, max-age=3600");
    // These are user-uploaded files served from our origin; never let a browser
    // decide one is HTML and run it.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    // The client is on its own origin, and helmet's site-wide default of
    // same-origin makes a browser refuse to render this in an <img>. Relaxed
    // only for this route, where being embedded elsewhere is the entire point
    // and the signature is what actually guards the file.
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

    (object.Body as Readable).pipe(res);
  } catch (error) {
    // A missing object arrives here as a NoSuchKey error; answer it the same way
    // as a bad signature rather than leaking that the key was real.
    if ((error as { name?: string }).name === "NoSuchKey") {
      res.status(404).json({ success: false, message: "File not found or link expired" });
      return;
    }
    next(error);
  }
};
