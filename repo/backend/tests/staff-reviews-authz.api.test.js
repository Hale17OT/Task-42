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
const staffRoutesPath = require.resolve("../src/modules/reviews/staff.routes");
const reviewsServicePath = require.resolve("../src/modules/reviews/reviews.service");

function buildApp() {
  clearModule(staffRoutesPath);
  clearModule(reviewsServicePath);

  setModuleMock(poolModulePath, { pool: { query: vi.fn(async () => [[]]) } });
  setModuleMock(reviewsServicePath, {
    addReply: vi.fn(async () => ({ id: 1 })),
    updateAppealStatus: vi.fn(async () => ({ id: 1, appeal_status: "upheld" })),
    listAppealsForStaff: vi.fn(async () => [])
  });

  const staffRoutes = require("../src/modules/reviews/staff.routes");

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
  app.use(staffRoutes.routes());
  app.use(staffRoutes.allowedMethods());
  return app;
}

describe("Staff review route authorization", () => {
  afterAll(() => {
    clearModule(poolModulePath);
    clearModule(staffRoutesPath);
    clearModule(reviewsServicePath);
  });

  test("unauthenticated GET /appeals returns 401", async () => {
    const app = buildApp();
    const res = await request(app.callback()).get("/api/v1/staff/reviews/appeals");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  test("regular user GET /appeals returns 403", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/staff/reviews/appeals")
      .set("x-test-user-id", "10")
      .set("x-test-user-roles", "user");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  test("coach GET /appeals returns 200", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/staff/reviews/appeals")
      .set("x-test-user-id", "5")
      .set("x-test-user-roles", "coach");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("support GET /appeals returns 200", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/staff/reviews/appeals")
      .set("x-test-user-id", "3")
      .set("x-test-user-roles", "support");
    expect(res.status).toBe(200);
  });

  test("unauthenticated POST /replies returns 401", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .post("/api/v1/staff/reviews/replies")
      .send({ reviewId: 1, replyText: "test reply" });
    expect(res.status).toBe(401);
  });

  test("regular user POST /replies returns 403", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .post("/api/v1/staff/reviews/replies")
      .set("x-test-user-id", "10")
      .set("x-test-user-roles", "user")
      .send({ reviewId: 1, replyText: "test reply" });
    expect(res.status).toBe(403);
  });

  test("unauthenticated PATCH /appeals/:id returns 401", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .patch("/api/v1/staff/reviews/appeals/1")
      .send({ appealStatus: "upheld" });
    expect(res.status).toBe(401);
  });

  test("regular user PATCH /appeals/:id returns 403", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .patch("/api/v1/staff/reviews/appeals/1")
      .set("x-test-user-id", "10")
      .set("x-test-user-roles", "user")
      .send({ appealStatus: "upheld" });
    expect(res.status).toBe(403);
  });
});
