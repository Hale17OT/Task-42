// Fast mocked route-level authz test. DB-backed ownership verification
// lives in idor-ownership.integration.test.js (run via npm run test:integration:db).
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
const placesRoutesPath = require.resolve("../src/modules/activities/places.routes");
const placesServicePath = require.resolve("../src/modules/activities/places.service");
const auditLogPath = require.resolve("../src/services/audit-log");

const OWNER_ID = 10;
const OTHER_USER_ID = 99;

function buildPlacesServiceMock() {
  const ApiError = require("../src/errors/api-error");
  return {
    listPlaces: vi.fn(async (userId) => {
      if (userId === OWNER_ID) return [{ id: 1, label: "Home", user_id: OWNER_ID }];
      return [];
    }),
    createPlace: vi.fn(async () => ({ id: 2, label: "New Place" })),
    updatePlace: vi.fn(async ({ userId }) => {
      if (userId !== OWNER_ID) throw new ApiError(404, "PLACE_NOT_FOUND", "Saved place not found");
      return { id: 1, label: "Updated" };
    }),
    deletePlace: vi.fn(async ({ userId }) => {
      if (userId !== OWNER_ID) throw new ApiError(404, "PLACE_NOT_FOUND", "Saved place not found");
      return { removed: true };
    })
  };
}

function buildApp() {
  clearModule(placesRoutesPath);
  clearModule(placesServicePath);

  setModuleMock(poolModulePath, { pool: { query: vi.fn(async () => [[]]) } });
  setModuleMock(auditLogPath, { writeAuditEvent: vi.fn() });
  setModuleMock(placesServicePath, buildPlacesServiceMock());

  const placesRoutes = require("../src/modules/activities/places.routes");

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
  app.use(placesRoutes.routes());
  app.use(placesRoutes.allowedMethods());
  return app;
}

describe("Places IDOR / authorization", () => {
  afterAll(() => {
    clearModule(poolModulePath);
    clearModule(placesRoutesPath);
    clearModule(placesServicePath);
    clearModule(auditLogPath);
  });

  test("unauthenticated GET /places returns 401", async () => {
    const app = buildApp();
    const res = await request(app.callback()).get("/api/v1/places");
    expect(res.status).toBe(401);
  });

  test("cross-user PATCH /places/:id returns 404", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .patch("/api/v1/places/1")
      .set("x-test-user-id", String(OTHER_USER_ID))
      .send({ label: "hacked" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PLACE_NOT_FOUND");
  });

  test("cross-user DELETE /places/:id returns 404", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .delete("/api/v1/places/1")
      .set("x-test-user-id", String(OTHER_USER_ID));
    expect(res.status).toBe(404);
  });

  test("owner PATCH /places/:id succeeds", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .patch("/api/v1/places/1")
      .set("x-test-user-id", String(OWNER_ID))
      .send({ label: "Updated" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
