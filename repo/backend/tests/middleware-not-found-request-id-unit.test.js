// Pure unit tests for notFound and requestId middleware.
const notFound = require("../src/middleware/not-found");
const requestId = require("../src/middleware/request-id");

describe("middleware/not-found — pure unit", () => {
  test("sets 404 status and NOT_FOUND error body", () => {
    const ctx = { state: { requestId: "req-99" }, status: 200, body: null };
    notFound(ctx);
    expect(ctx.status).toBe(404);
    expect(ctx.body.success).toBe(false);
    expect(ctx.body.error.code).toBe("NOT_FOUND");
    expect(ctx.body.error.message).toBe("Route not found");
    expect(ctx.body.error.requestId).toBe("req-99");
  });

  test("works with missing requestId", () => {
    const ctx = { state: {}, status: 200, body: null };
    notFound(ctx);
    expect(ctx.body.error.requestId).toBeNull();
  });
});

describe("middleware/request-id — pure unit", () => {
  test("generates a UUID when no incoming header", async () => {
    const ctx = {
      state: {},
      _headers: {},
      get(h) { return this._reqHeaders?.[h.toLowerCase()]; },
      set(k, v) { this._headers[k] = v; },
      _reqHeaders: {}
    };
    await requestId(ctx, async () => {});
    expect(ctx.state.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ctx._headers["x-request-id"]).toBe(ctx.state.requestId);
  });

  test("preserves incoming x-request-id header", async () => {
    const incoming = "abc-123-incoming";
    const ctx = {
      state: {},
      _headers: {},
      get(h) { return h.toLowerCase() === "x-request-id" ? incoming : undefined; },
      set(k, v) { this._headers[k] = v; }
    };
    await requestId(ctx, async () => {});
    expect(ctx.state.requestId).toBe(incoming);
    expect(ctx._headers["x-request-id"]).toBe(incoming);
  });

  test("calls next middleware", async () => {
    const ctx = { state: {}, get: () => undefined, set: () => {} };
    let called = false;
    await requestId(ctx, async () => { called = true; });
    expect(called).toBe(true);
  });
});
