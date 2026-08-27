import { describe, expect, it, beforeAll } from "bun:test";
import express from "express";
import { signRequest } from "../utils/signing.js";

/**
 * The integration API's front door, exercised end to end through a real Express
 * app. No database is involved: what is under test is whether an unsigned,
 * stale, replayed or tampered request can get past the middleware, and none of
 * those questions touch Mongo.
 *
 * env.ts validates on import and exits the process when it fails, so the
 * environment is set up before the dynamic import below rather than at the top
 * of the file.
 */

// Must match src/test-setup.ts, which installs these before anything loads.
const SECRET = "integration-secret-long-enough-to-pass-validation";
const CLIENT = "delta-finance";
const PATH = "/api/v1/integrations/ping";

let app: express.Express;

beforeAll(async () => {
  // Credentials come from src/test-setup.ts, preloaded before any module.
  const { serviceAuth } = await import("./serviceAuth.js");

  app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(PATH, serviceAuth, (_req, res) => {
    res.json({ success: true, message: "ok" });
  });
});

function headers(opts: { ts?: number; nonce?: string; body?: string; url?: string; method?: string } = {}) {
  const ts = String(opts.ts ?? Date.now());
  const nonce = opts.nonce ?? crypto.randomUUID();
  const url = opts.url ?? PATH;
  const method = opts.method ?? "GET";
  return {
    "Content-Type": "application/json",
    "X-Delta-Client": CLIENT,
    "X-Delta-Timestamp": ts,
    "X-Delta-Nonce": nonce,
    "X-Delta-Signature": signRequest(SECRET, method, url, ts, nonce, opts.body ?? ""),
  };
}

async function send(headerBag: Record<string, string>, url = PATH, method = "GET", body?: string) {
  return await new Promise<{ status: number }>((resolve) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as { port: number }).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: headerBag, body });
        resolve({ status: res.status });
      } finally {
        server.close();
      }
    });
  });
}

describe("serviceAuth", () => {
  it("accepts a correctly signed request", async () => {
    expect((await send(headers())).status).toBe(200);
  });

  it("rejects a request with no signature headers at all", async () => {
    expect((await send({ "Content-Type": "application/json" })).status).toBe(401);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const ts = String(Date.now());
    const nonce = crypto.randomUUID();
    expect(
      (
        await send({
          "X-Delta-Client": CLIENT,
          "X-Delta-Timestamp": ts,
          "X-Delta-Nonce": nonce,
          "X-Delta-Signature": signRequest("the-wrong-secret-but-still-long-enough", "GET", PATH, ts, nonce, ""),
        })
      ).status,
    ).toBe(401);
  });

  it("rejects an unknown client id", async () => {
    const h = headers();
    h["X-Delta-Client"] = "somebody-else";
    expect((await send(h)).status).toBe(401);
  });

  it("rejects a request older than the clock-skew window", async () => {
    expect((await send(headers({ ts: Date.now() - 10 * 60 * 1000 }))).status).toBe(401);
  });

  it("rejects a request from too far in the future", async () => {
    expect((await send(headers({ ts: Date.now() + 10 * 60 * 1000 }))).status).toBe(401);
  });

  it("rejects a replay of a request it has already seen", async () => {
    const h = headers({ nonce: "replay-me-once" });
    expect((await send(h)).status).toBe(200);
    // Same nonce, same signature, still within the window — the only thing
    // stopping this is the spent-nonce set.
    expect((await send(h)).status).toBe(401);
  });

  it("rejects a request whose URL was altered after signing", async () => {
    const h = headers({ url: PATH });
    expect((await send(h, `${PATH}?organizationId=deadbeef`)).status).toBe(401);
  });

  it("rejects a request whose body was altered after signing", async () => {
    const body = JSON.stringify({ amount: 100 });
    const h = headers({ body, method: "POST" });
    expect((await send(h, PATH, "POST", JSON.stringify({ amount: 999_999 }))).status).toBe(401);
  });
});
