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
const governanceRoutesPath = require.resolve("../src/modules/reviews/admin-governance.routes");

function buildApp() {
  clearModule(governanceRoutesPath);

  setModuleMock(poolModulePath, { pool: { query: vi.fn(async () => [[]]) } });

  const governanceRoutes = require("../src/modules/reviews/admin-governance.routes");

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
  app.use(governanceRoutes.routes());
  app.use(governanceRoutes.allowedMethods());
  return app;
}

describe("Admin review governance authorization", () => {
  afterAll(() => {
    clearModule(poolModulePath);
    clearModule(governanceRoutesPath);
  });

  test("unauthenticated GET /dimensions returns 401", async () => {
    const app = buildApp();
    const res = await request(app.callback()).get("/api/v1/admin/review-governance/dimensions");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  test("regular user GET /dimensions returns 403", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/admin/review-governance/dimensions")
      .set("x-test-user-id", "10")
      .set("x-test-user-roles", "user");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  test("support user GET /dimensions returns 403", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/admin/review-governance/dimensions")
      .set("x-test-user-id", "3")
      .set("x-test-user-roles", "support");
    expect(res.status).toBe(403);
  });

  test("admin GET /dimensions returns 200", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/admin/review-governance/dimensions")
      .set("x-test-user-id", "1")
      .set("x-test-user-roles", "admin");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("unauthenticated GET /sensitive-words returns 401", async () => {
    const app = buildApp();
    const res = await request(app.callback()).get("/api/v1/admin/review-governance/sensitive-words");
    expect(res.status).toBe(401);
  });

  test("coach GET /sensitive-words returns 403", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/admin/review-governance/sensitive-words")
      .set("x-test-user-id", "5")
      .set("x-test-user-roles", "coach");
    expect(res.status).toBe(403);
  });

  test("unauthenticated GET /blacklist returns 401", async () => {
    const app = buildApp();
    const res = await request(app.callback()).get("/api/v1/admin/review-governance/blacklist");
    expect(res.status).toBe(401);
  });

  test("regular user POST /blacklist returns 403", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .post("/api/v1/admin/review-governance/blacklist")
      .set("x-test-user-id", "10")
      .set("x-test-user-roles", "user")
      .send({ userId: 5, reason: "test reason", days: 30 });
    expect(res.status).toBe(403);
  });

  test("unauthenticated GET /denylist-hashes returns 401", async () => {
    const app = buildApp();
    const res = await request(app.callback()).get("/api/v1/admin/review-governance/denylist-hashes");
    expect(res.status).toBe(401);
  });
});
