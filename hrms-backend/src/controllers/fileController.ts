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
    /**
     * A policy that does not forbid the file it is attached to.
     *
     * `default-src 'none'; sandbox` on everything meant a PDF framed by the
     * client was refused with ERR_BLOCKED_BY_RESPONSE: inside an iframe the
     * response is a document, so the header applies to it, and `sandbox`
     * without `allow-same-origin` puts that document in an opaque origin where
     * `default-src 'none'` blocks the viewer from loading the very bytes it was
     * given. Opening the same URL in a tab was never affected, which is what
     * made this look like a client bug for so long.
     *
     * The header is there to stop an uploaded HTML file executing, and that is
     * a risk belonging to types a browser will run. Types it merely displays —
     * a PDF, an image, a video, served under their own content type with
     * `nosniff` — get a policy that permits the file and nothing else. The
     * allowlist is matched against the *stored* content type, so something
     * uploaded as text/html never qualifies however it is named.
     */
    const contentType = object.ContentType ?? "";
    const inert = /^(image\/|video\/|audio\/)/.test(contentType) || contentType === "application/pdf";
    res.setHeader(
      "Content-Security-Policy",
      inert
        ? "default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'self'; style-src 'unsafe-inline'; frame-ancestors *"
        : "default-src 'none'; sandbox"
    );
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
