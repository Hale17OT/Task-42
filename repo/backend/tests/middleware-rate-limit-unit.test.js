// Pure unit tests for createWindowRateLimiter without HTTP.
const { createWindowRateLimiter } = require("../src/middleware/auth-rate-limit");

function makeCtx({ ip = "1.2.3.4", username = "u" } = {}) {
  return {
    ip,
    request: { ip, body: { username } },
    path: "/api/v1/auth/login",
    method: "POST",
    state: {},
    status: 200,
    _headers: {},
    set(key, value) { this._headers[key] = value; }
  };
}

describe("createWindowRateLimiter — pure unit", () => {
  test("allows requests under the IP+username limit", async () => {
    const rl = createWindowRateLimiter({ maxPerIp: 100, maxPerIpUsername: 5, windowMs: 60000 });
    for (let i = 0; i < 5; i += 1) {
      const ctx = makeCtx();
      let called = false;
      await rl(ctx, async () => { called = true; ctx.status = 401; });
      expect(called).toBe(true);
    }
  });

  test("throws 429 TOO_MANY_LOGIN_ATTEMPTS when IP+username limit exceeded", async () => {
    const rl = createWindowRateLimiter({ maxPerIp: 100, maxPerIpUsername: 3, windowMs: 60000 });
    for (let i = 0; i < 3; i += 1) {
      const ctx = makeCtx();
      await rl(ctx, async () => { ctx.status = 401; });
    }
    const ctx = makeCtx();
    await expect(rl(ctx, async () => {})).rejects.toMatchObject({
      status: 429,
      code: "TOO_MANY_LOGIN_ATTEMPTS"
    });
  });

  test("throws 429 when IP-only limit exceeded", async () => {
    const rl = createWindowRateLimiter({ maxPerIp: 2, maxPerIpUsername: 100, windowMs: 60000 });
    await rl(makeCtx({ username: "u1" }), async () => {});
    await rl(makeCtx({ username: "u2" }), async () => {});
    const ctx = makeCtx({ username: "u3" });
    await expect(rl(ctx, async () => {})).rejects.toMatchObject({ status: 429 });
  });

  test("successful login resets the IP+username bucket", async () => {
    const rl = createWindowRateLimiter({ maxPerIp: 100, maxPerIpUsername: 3, windowMs: 60000 });
    for (let i = 0; i < 2; i += 1) {
      await rl(makeCtx(), async () => { /* status 200 default */ });
    }
    // After 2 successful logins the IP+user bucket should be clear; 3 more succeed
    for (let i = 0; i < 3; i += 1) {
      await rl(makeCtx(), async () => {});
    }
  });

  test("reset() clears all buckets", async () => {
    const rl = createWindowRateLimiter({ maxPerIp: 2, maxPerIpUsername: 100, windowMs: 60000 });
    await rl(makeCtx(), async () => {});
    await rl(makeCtx(), async () => {});

    rl.reset();

    await rl(makeCtx(), async () => {});
    await rl(makeCtx(), async () => {});
  });

  test("sets Retry-After header on 429 response", async () => {
    const rl = createWindowRateLimiter({ maxPerIp: 1, maxPerIpUsername: 100, windowMs: 10000 });
    await rl(makeCtx({ ip: "9.9.9.9" }), async () => {});
    const ctx = makeCtx({ ip: "9.9.9.9" });
    try {
      await rl(ctx, async () => {});
    } catch {}
    expect(ctx._headers["Retry-After"]).toBeDefined();
    expect(Number(ctx._headers["Retry-After"])).toBeGreaterThan(0);
  });

  test("handles missing username (undefined body.username) gracefully", async () => {
    const rl = createWindowRateLimiter({ maxPerIp: 5, maxPerIpUsername: 1, windowMs: 60000 });
    const ctx = { ip: "5.5.5.5", request: { body: {} }, state: {}, status: 200, set() {} };
    let called = false;
    await rl(ctx, async () => { called = true; });
    expect(called).toBe(true);
  });
});
