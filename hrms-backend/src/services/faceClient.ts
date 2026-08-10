import { env } from "../config/env.js";

/**
 * HTTP client for the face recognition service (hrms-face-ditector).
 *
 * The service is the only thing in the stack that sees a face image, and it is
 * reachable on loopback only, so this module is the whole trust boundary: every
 * call goes out with the shared key, and every error comes back as a coded
 * failure the callers can act on rather than a raw fetch rejection.
 */

export interface FaceQuality {
  det_score: number;
  face_pixels: number;
  blur: number;
  brightness: number;
  yaw: number | null;
  pitch: number | null;
  roll: number | null;
  passed: boolean;
  failures: string[];
}

export interface EmbeddedFace {
  embedding: number[];
  bbox: { x1: number; y1: number; x2: number; y2: number };
  quality: FaceQuality;
}

export interface GalleryState {
  org_id: string;
  version: string;
  users: number;
  vectors: number;
  synced_at: number;
}

export class FaceServiceError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(message: string, statusCode: number, code: string, details?: unknown) {
    super(message);
    this.name = "FaceServiceError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** Face features are off unless both the URL and the shared key are configured. */
export const faceServiceEnabled = Boolean(env.FACE_SERVICE_URL && env.FACE_SERVICE_KEY);

const BASE_URL = (env.FACE_SERVICE_URL ?? "").replace(/\/+$/, "");
const TIMEOUT_MS = Number(env.FACE_SERVICE_TIMEOUT_MS) || 15_000;

function ensureEnabled(): void {
  if (!faceServiceEnabled) {
    throw new FaceServiceError(
      "Face recognition is not configured. Set FACE_SERVICE_URL and FACE_SERVICE_KEY.",
      503,
      "FACE_SERVICE_DISABLED"
    );
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: T }> {
  ensureEnabled();

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-face-service-key": env.FACE_SERVICE_KEY!,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // Down, refusing connections, or still loading its model pack. Callers
    // surface this as "try again in a moment", never as a failed enrollment.
    const reason = error instanceof Error ? error.message : String(error);
    throw new FaceServiceError(
      `Face service is unreachable (${reason})`,
      503,
      "FACE_SERVICE_UNREACHABLE"
    );
  }

  if (response.status === 204) return { status: 204, data: undefined as T };

  const payload = await response.json().catch(() => ({}) as Record<string, unknown>);

  if (!response.ok) {
    const { code, message, ...details } = payload as {
      code?: string;
      message?: string;
    } & Record<string, unknown>;
    throw new FaceServiceError(
      message ?? `Face service returned ${response.status}`,
      response.status,
      code ?? "FACE_SERVICE_ERROR",
      details
    );
  }

  return { status: response.status, data: payload as T };
}

/** Turn enrollment captures into embeddings. Rejects anything unusable. */
export async function embedFaces(images: string[]): Promise<EmbeddedFace[]> {
  const { data } = await request<{ faces: EmbeddedFace[]; model_pack: string }>(
    "POST",
    "/v1/embed",
    { images }
  );
  return data.faces;
}

/** The model pack the service is running — embeddings are pack-specific. */
export async function serviceModelPack(): Promise<string> {
  const { data } = await request<{ model_pack: string }>("GET", "/health");
  return data.model_pack;
}

/** Gallery currently loaded for an org, or null if the service has none. */
export async function getGallery(orgKey: string): Promise<GalleryState | null> {
  try {
    const { data } = await request<GalleryState>("GET", `/v1/gallery/${encodeURIComponent(orgKey)}`);
    return data;
  } catch (error) {
    if (error instanceof FaceServiceError && error.code === "GALLERY_NOT_LOADED") return null;
    throw error;
  }
}

export type RecognizeReason =
  | "MATCHED"
  | "NO_FACE"
  | "AMBIGUOUS_FRAME"
  | "LOW_QUALITY"
  | "BELOW_THRESHOLD"
  | "AMBIGUOUS_MATCH"
  | "EMPTY_GALLERY";

export type LivenessReason =
  | "OK"
  | "NOT_REQUESTED"
  | "NO_FACE_IN_FRAMES"
  | "POSE_UNAVAILABLE"
  | "DIFFERENT_PEOPLE"
  | "IDENTICAL_FRAMES"
  | "STEP_NOT_SEEN"
  | "SPOOF_DETECTED";

export interface LivenessResult {
  live: boolean;
  reason: LivenessReason;
  required: string[];
  matched_frames: (number | null)[];
  same_person: boolean | null;
  frame_difference: number | null;
  spoof_score: number | null;
  detail: string;
}

export interface RecognizeResult {
  matched: boolean;
  reason: RecognizeReason;
  best: { user_id: string; score: number } | null;
  runner_up: { user_id: string; score: number } | null;
  /** Top scorers, highest first — needed to spot a clash with anyone, not just
   *  whoever happened to come first. */
  candidates: { user_id: string; score: number }[];
  margin: number | null;
  quality: FaceQuality | null;
  frame_index: number | null;
  faces_detected: number;
  gallery_version: string | null;
  thresholds: { min_score: number; min_margin: number };
  liveness: LivenessResult;
}

/**
 * Identify whoever is in these frames.
 *
 * An unreadable frame comes back as `matched: false` with a reason, not an
 * error — someone standing slightly wrong is the normal case at a kiosk, and
 * the caller turns the reason into "step closer".
 */
export async function recognize(
  orgKey: string,
  images: string[],
  steps?: string[]
): Promise<RecognizeResult> {
  const { data } = await request<RecognizeResult>("POST", "/v1/recognize", {
    org_id: orgKey,
    images,
    // Omitted when liveness is off, and the service then reports
    // NOT_REQUESTED rather than a passed check.
    ...(steps?.length ? { liveness: { steps } } : {}),
  });
  return data;
}

export async function replaceGallery(
  orgKey: string,
  version: string,
  entries: { user_id: string; embeddings: number[][] }[]
): Promise<GalleryState> {
  const { data } = await request<GalleryState>(
    "PUT",
    `/v1/gallery/${encodeURIComponent(orgKey)}`,
    { version, entries }
  );
  return data;
}
