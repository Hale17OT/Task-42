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
const followsRoutesPath = require.resolve("../src/modules/follows/follows.routes");
const followsServicePath = require.resolve("../src/modules/follows/follows.service");

function buildApp() {
  clearModule(followsRoutesPath);
  clearModule(followsServicePath);

  setModuleMock(poolModulePath, { pool: { query: vi.fn(async () => [[]]) } });
  setModuleMock(followsServicePath, {
    followUser: vi.fn(async () => ({ id: 1, duplicate: false })),
    unfollowUser: vi.fn(async () => ({ removed: true })),
    listMyFollows: vi.fn(async () => []),
    listFollowedAuthorIds: vi.fn(async () => [])
  });

  const followsRoutes = require("../src/modules/follows/follows.routes");

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
        roles: ["user"]
      };
    }
    await next();
  });
  app.use(followsRoutes.routes());
  app.use(followsRoutes.allowedMethods());
  return app;
}

describe("Follows validation (hermetic)", () => {
  afterAll(() => {
    clearModule(poolModulePath);
    clearModule(followsRoutesPath);
    clearModule(followsServicePath);
  });

  test("POST /follows/:userId with non-numeric param returns 400", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .post("/api/v1/follows/notanumber")
      .set("x-test-user-id", "10");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("DELETE /follows/:userId with non-numeric param returns 400", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .delete("/api/v1/follows/invalid")
      .set("x-test-user-id", "10");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("POST /follows/:userId with valid param succeeds", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .post("/api/v1/follows/5")
      .set("x-test-user-id", "10");
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});
