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
const analyticsRoutesPath = require.resolve("../src/modules/analytics/analytics.routes");
const analyticsServicePath = require.resolve("../src/modules/analytics/analytics.service");

function buildApp() {
  clearModule(analyticsRoutesPath);
  clearModule(analyticsServicePath);

  setModuleMock(poolModulePath, { pool: { query: vi.fn(async () => [[]]) } });
  setModuleMock(analyticsServicePath, {
    runDashboard: vi.fn(async () => ({ metrics: [] })),
    runReport: vi.fn(async () => []),
    exportReportCsv: vi.fn(async () => ({ csv: "a,b\n1,2", fileName: "report.csv" })),
    listExportAccessLogs: vi.fn(async () => [])
  });

  const analyticsRoutes = require("../src/modules/analytics/analytics.routes");

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
  app.use(analyticsRoutes.routes());
  app.use(analyticsRoutes.allowedMethods());
  return app;
}

describe("Admin analytics route authorization", () => {
  afterAll(() => {
    clearModule(poolModulePath);
    clearModule(analyticsRoutesPath);
    clearModule(analyticsServicePath);
  });

  test("unauthenticated GET /dashboard returns 401", async () => {
    const app = buildApp();
    const res = await request(app.callback()).get("/api/v1/admin/analytics/dashboard");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  test("regular user GET /dashboard returns 403", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/admin/analytics/dashboard")
      .set("x-test-user-id", "10")
      .set("x-test-user-roles", "user");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  test("coach GET /dashboard returns 403", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/admin/analytics/dashboard")
      .set("x-test-user-id", "5")
      .set("x-test-user-roles", "coach");
    expect(res.status).toBe(403);
  });

  test("support user GET /dashboard returns 200", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/admin/analytics/dashboard")
      .set("x-test-user-id", "3")
      .set("x-test-user-roles", "support");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("admin GET /dashboard returns 200", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/admin/analytics/dashboard")
      .set("x-test-user-id", "1")
      .set("x-test-user-roles", "admin");
    expect(res.status).toBe(200);
  });

  test("unauthenticated GET /export-logs returns 401", async () => {
    const app = buildApp();
    const res = await request(app.callback()).get("/api/v1/admin/analytics/export-logs");
    expect(res.status).toBe(401);
  });

  test("regular user GET /export-logs returns 403", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/admin/analytics/export-logs")
      .set("x-test-user-id", "10")
      .set("x-test-user-roles", "user");
    expect(res.status).toBe(403);
  });
});
