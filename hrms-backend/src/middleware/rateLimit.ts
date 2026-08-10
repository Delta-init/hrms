import rateLimit from "express-rate-limit";

/**
 * Credential-guessing guard for the unauthenticated auth endpoints. Keyed by IP
 * so a single client can't grind login/set-password, which are otherwise
 * unlimited (bcrypt cost alone is not a throttle).
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { success: false, message: "Too many attempts. Please try again later." },
});

/**
 * Ceiling on how fast one device can submit frames.
 *
 * A kiosk in a busy lobby is a few punches a minute, and each one costs about a
 * second of CPU inference on a shared box. This is generous for real use and
 * still stops a device — or anything holding its token — from turning the face
 * service into a queue nobody else can get through.
 */
export const kioskPunchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Wait a moment and try again." },
});

/**
 * Looser limit for token exchange/refresh: these run on a legitimate cadence
 * for active sessions, so they need headroom the login limiter shouldn't give.
 */
export const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please try again later." },
});
