import mongoose, { type ClientSession } from "mongoose";

/**
 * Run `fn` in a Mongo transaction when the database supports one (a replica set
 * or mongos), otherwise straight through.
 *
 * Every DGO write is safe on its own either way — the ledger and earning keys are
 * unique and the budget moves by conditional increments — so a transaction adds
 * all-or-nothing on top rather than being what correctness rests on. `fn` may be
 * retried by the driver on a transient error, so it must only write through
 * `session`.
 */
let supported: boolean | null = null;

export async function transactionsSupported(): Promise<boolean> {
  if (supported !== null) return supported;
  try {
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    supported = Boolean(hello.setName) || hello.msg === "isdbgrid";
  } catch {
    supported = false;
  }
  return supported;
}

/** For the check script: force the plain path to prove it holds without transactions. */
export function setTransactionsSupportedForTest(value: boolean | null): void {
  supported = value;
}

export async function inTransaction<T>(fn: (session: ClientSession | undefined) => Promise<T>): Promise<T> {
  if (!(await transactionsSupported())) return fn(undefined);
  const session = await mongoose.startSession();
  try {
    let out!: T;
    await session.withTransaction(async () => {
      out = await fn(session);
    });
    return out;
  } finally {
    await session.endSession();
  }
}
