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
