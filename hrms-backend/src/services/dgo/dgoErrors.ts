/** An error the error handler answers with this status and message. */
export const httpError = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

/** Mongo's duplicate-key error: how a repeated idempotency key shows itself. */
export const isDuplicateKey = (e: unknown): boolean => (e as { code?: number })?.code === 11000;
