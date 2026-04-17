// Pure unit tests for error-handler middleware — no HTTP, no mocks.
const errorHandler = require("../src/middleware/error-handler");
const ApiError = require("../src/errors/api-error");

function makeCtx() {
  return {
    state: { requestId: "req-123" },
    status: 200,
    body: null,
    path: "/test",
    method: "GET"
  };
}

describe("middleware/error-handler — pure unit", () => {
  test("passes through when no error thrown", async () => {
    const ctx = makeCtx();
    await errorHandler(ctx, async () => { ctx.body = "ok"; });
    expect(ctx.body).toBe("ok");
  });

  test("serializes ApiError 401 to structured error response", async () => {
    const ctx = makeCtx();
    await errorHandler(ctx, async () => {
      throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    });
    expect(ctx.status).toBe(401);
    expect(ctx.body.success).toBe(false);
    expect(ctx.body.error.code).toBe("UNAUTHORIZED");
    expect(ctx.body.error.message).toBe("Authentication required");
    expect(ctx.body.error.requestId).toBe("req-123");
  });

  test("500 errors return generic 'Internal Server Error' message", async () => {
    const ctx = makeCtx();
    await errorHandler(ctx, async () => {
      throw new Error("DB panic with secret details");
    });
    expect(ctx.status).toBe(500);
    expect(ctx.body.error.message).toBe("Internal Server Error");
    expect(ctx.body.error.message).not.toContain("secret details");
    expect(ctx.body.error.code).toBe("INTERNAL_ERROR");
  });

  test("validation error details are passed through for non-moderation codes", async () => {
    const ctx = makeCtx();
    await errorHandler(ctx, async () => {
      throw new ApiError(400, "VALIDATION_ERROR", "Invalid body", { fields: ["name"] });
    });
    expect(ctx.body.error.details).toEqual({ fields: ["name"] });
  });

  test("SENSITIVE_WORD_DETECTED has details stripped from response", async () => {
    const ctx = makeCtx();
    await errorHandler(ctx, async () => {
      const err = new Error("Content contains restricted words");
      err.status = 400;
      err.code = "SENSITIVE_WORD_DETECTED";
      err.details = { matched: ["badword"] };
      throw err;
    });
    expect(ctx.status).toBe(400);
    expect(ctx.body.error.code).toBe("SENSITIVE_WORD_DETECTED");
    expect(ctx.body.error.details).toBeNull();
    expect(JSON.stringify(ctx.body)).not.toContain("badword");
  });

  test("IMAGE_HASH_DENIED has details stripped from response", async () => {
    const ctx = makeCtx();
    await errorHandler(ctx, async () => {
      const err = new Error("Image hash is deny-listed");
      err.status = 400;
      err.code = "IMAGE_HASH_DENIED";
      err.details = { hash: "deadbeef" };
      throw err;
    });
    expect(ctx.body.error.details).toBeNull();
  });

  test("REVIEW_BLACKLISTED has details stripped", async () => {
    const ctx = makeCtx();
    await errorHandler(ctx, async () => {
      const err = new Error("blacklisted");
      err.status = 403;
      err.code = "REVIEW_BLACKLISTED";
      err.details = { until: "2025-01-01" };
      throw err;
    });
    expect(ctx.body.error.details).toBeNull();
  });

  test("unknown error without code defaults to REQUEST_ERROR for <500", async () => {
    const ctx = makeCtx();
    await errorHandler(ctx, async () => {
      const err = new Error("boom");
      err.status = 400;
      throw err;
    });
    expect(ctx.body.error.code).toBe("REQUEST_ERROR");
  });

  test("preserves requestId in error response", async () => {
    const ctx = makeCtx();
    ctx.state.requestId = "unique-req-789";
    await errorHandler(ctx, async () => {
      throw new ApiError(404, "NOT_FOUND", "x");
    });
    expect(ctx.body.error.requestId).toBe("unique-req-789");
  });

  test("null requestId is handled gracefully", async () => {
    const ctx = { state: {}, status: 200, body: null, path: "/x", method: "GET" };
    await errorHandler(ctx, async () => {
      throw new ApiError(400, "X", "y");
    });
    expect(ctx.body.error.requestId).toBeNull();
  });
});
