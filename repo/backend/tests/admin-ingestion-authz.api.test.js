const Koa = require("koa");
const bodyParser = require("koa-bodyparser");
const request = require("supertest");
const requestId = require("../src/middleware/request-id");
const errorHandler = require("../src/middleware/error-handler");

function setModuleMock(modulePath, exportsValue) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsValue
  };
}

function clearModule(modulePath) {
  delete require.cache[modulePath];
}

const poolModulePath = require.resolve("../src/db/pool");
const ingestionRoutesPath = require.resolve("../src/modules/ingestion/ingestion.routes");
const ingestionServicePath = require.resolve("../src/modules/ingestion/ingestion.service");
const auditLogPath = require.resolve("../src/services/audit-log");
const envPath = require.resolve("../src/config/env");

function buildApp() {
  clearModule(ingestionRoutesPath);
  clearModule(ingestionServicePath);

  setModuleMock(poolModulePath, { pool: { query: vi.fn(async () => [[]]) } });
  setModuleMock(auditLogPath, { writeAuditEvent: vi.fn() });
  setModuleMock(envPath, {
    SESSION_SECRET: "test",
    CORS_ORIGIN: "*",
    INGESTION_RATE_LIMIT_PER_MINUTE: 100,
    INGESTION_DROP_DIR: "/tmp/test"
  });
  setModuleMock(ingestionServicePath, {
    listContentSources: vi.fn(async () => []),
    createContentSource: vi.fn(async () => ({ id: 1 })),
    updateContentSource: vi.fn(async () => ({ id: 1 })),
    listIngestionLogs: vi.fn(async () => []),
    enqueueIngestionScanJob: vi.fn(async () => {})
  });

  const ingestionRoutes = require("../src/modules/ingestion/ingestion.routes");

  const app = new Koa();
  app.use(errorHandler);
  app.use(requestId);
  app.use(bodyParser({ enableTypes: ["json"] }));
  app.use(async (ctx, next) => {
    const userId = ctx.get("x-test-user-id");
    if (userId) {
      ctx.state.user = {
        id: Number(userId),
        username: "test-user",
        email: "test@example.local",
        status: "active",
        sessionId: 1,
        roles: (ctx.get("x-test-user-roles") || "")
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean)
      };
    }
    await next();
  });
  app.use(ingestionRoutes.routes());
  app.use(ingestionRoutes.allowedMethods());
  return app;
}

describe("Admin ingestion route authorization", () => {
  afterAll(() => {
    clearModule(poolModulePath);
    clearModule(ingestionRoutesPath);
    clearModule(ingestionServicePath);
    clearModule(auditLogPath);
    clearModule(envPath);
  });

  test("unauthenticated GET /sources returns 401", async () => {
    const app = buildApp();
    const res = await request(app.callback()).get("/api/v1/admin/ingestion/sources");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  test("regular user GET /sources returns 403", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/admin/ingestion/sources")
      .set("x-test-user-id", "10")
      .set("x-test-user-roles", "user");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  test("admin GET /sources returns 200", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/admin/ingestion/sources")
      .set("x-test-user-id", "1")
      .set("x-test-user-roles", "admin");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("unauthenticated POST /scan returns 401", async () => {
    const app = buildApp();
    const res = await request(app.callback()).post("/api/v1/admin/ingestion/scan");
    expect(res.status).toBe(401);
  });

  test("coach POST /scan returns 403", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .post("/api/v1/admin/ingestion/scan")
      .set("x-test-user-id", "5")
      .set("x-test-user-roles", "coach");
    expect(res.status).toBe(403);
  });

  test("unauthenticated GET /logs returns 401", async () => {
    const app = buildApp();
    const res = await request(app.callback()).get("/api/v1/admin/ingestion/logs");
    expect(res.status).toBe(401);
  });

  test("support user GET /logs returns 403", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/admin/ingestion/logs")
      .set("x-test-user-id", "3")
      .set("x-test-user-roles", "support");
    expect(res.status).toBe(403);
  });
});
