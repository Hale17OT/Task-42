const Koa = require("koa");
const request = require("supertest");
const requestId = require("../src/middleware/request-id");
const errorHandler = require("../src/middleware/error-handler");
const logger = require("../src/logger");

describe("Error handler log redaction", () => {
  let logSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test("error details are redacted in log output", async () => {
    const app = new Koa();
    app.use(errorHandler);
    app.use(requestId);
    app.use(() => {
      const err = new Error("Sensitive word match");
      err.status = 400;
      err.code = "SENSITIVE_WORD_DETECTED";
      err.details = { matched: ["badword1", "badword2"], userInput: "some sensitive text" };
      throw err;
    });

    await request(app.callback()).get("/test");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const loggedObject = logSpy.mock.calls[0][0];

    // err.details should be redacted, not contain the actual matched words
    expect(loggedObject.err.details).toBe("[redacted]");
    expect(loggedObject.err.message).toBe("Sensitive word match");
    expect(loggedObject.err.code).toBe("SENSITIVE_WORD_DETECTED");

    // Should not contain any raw user input or matched words
    const serialized = JSON.stringify(loggedObject);
    expect(serialized).not.toContain("badword1");
    expect(serialized).not.toContain("some sensitive text");
  });

  test("errors without details log details as null", async () => {
    const app = new Koa();
    app.use(errorHandler);
    app.use(requestId);
    app.use(() => {
      const err = new Error("Auth required");
      err.status = 401;
      err.code = "UNAUTHORIZED";
      throw err;
    });

    await request(app.callback()).get("/test");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const loggedObject = logSpy.mock.calls[0][0];
    expect(loggedObject.err.details).toBeNull();
  });

  test("moderation error codes have details stripped from client response", async () => {
    const app = new Koa();
    app.use(errorHandler);
    app.use(requestId);
    app.use(() => {
      const err = new Error("Content contains restricted words");
      err.status = 400;
      err.code = "SENSITIVE_WORD_DETECTED";
      // Even if details were somehow set, the handler should strip them
      err.details = { matched: ["secret_word"], count: 1 };
      throw err;
    });

    const res = await request(app.callback()).get("/test");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SENSITIVE_WORD_DETECTED");
    // Client response must have null details for moderation codes
    expect(res.body.error.details).toBeNull();
    // Body must not contain the matched word
    expect(JSON.stringify(res.body)).not.toContain("secret_word");
  });

  test("logged error only contains whitelisted fields", async () => {
    const app = new Koa();
    app.use(errorHandler);
    app.use(requestId);
    app.use(() => {
      const err = new Error("Test error");
      err.status = 500;
      err.code = "INTERNAL_ERROR";
      err.sensitiveField = "should not appear";
      err.dbConnection = { host: "secret-host", password: "secret" };
      throw err;
    });

    await request(app.callback()).get("/test");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const loggedErr = logSpy.mock.calls[0][0].err;

    // Only whitelisted fields should be present
    const allowedKeys = ["type", "message", "stack", "name", "status", "code", "details"];
    const actualKeys = Object.keys(loggedErr);
    for (const key of actualKeys) {
      expect(allowedKeys).toContain(key);
    }

    // Sensitive fields must not appear
    expect(loggedErr.sensitiveField).toBeUndefined();
    expect(loggedErr.dbConnection).toBeUndefined();

    const serialized = JSON.stringify(loggedErr);
    expect(serialized).not.toContain("secret-host");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("should not appear");
  });
});
