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
const activitiesRoutesPath = require.resolve("../src/modules/activities/activities.routes");
const activitiesServicePath = require.resolve("../src/modules/activities/activities.service");
const auditLogPath = require.resolve("../src/services/audit-log");

const OWNER_ID = 10;
const OTHER_USER_ID = 99;

function buildActivitiesServiceMock() {
  return {
    listActivities: vi.fn(async (userId) => {
      if (userId === OWNER_ID) return [{ id: 1, user_id: OWNER_ID, activity_type: "running" }];
      return [];
    }),
    createActivity: vi.fn(async () => ({ id: 2, user_id: OWNER_ID })),
    getActivityById: vi.fn(async ({ userId, activityId }) => {
      if (userId !== OWNER_ID) {
        const ApiError = require("../src/errors/api-error");
        throw new ApiError(404, "ACTIVITY_NOT_FOUND", "Activity not found");
      }
      return { id: activityId, user_id: OWNER_ID, activity_type: "running" };
    }),
    updateActivity: vi.fn(async ({ userId }) => {
      if (userId !== OWNER_ID) {
        const ApiError = require("../src/errors/api-error");
        throw new ApiError(404, "ACTIVITY_NOT_FOUND", "Activity not found");
      }
      return { id: 1, user_id: OWNER_ID };
    }),
    archiveActivity: vi.fn(async ({ userId }) => {
      if (userId !== OWNER_ID) {
        const ApiError = require("../src/errors/api-error");
        throw new ApiError(404, "ACTIVITY_NOT_FOUND", "Activity not found");
      }
      return { removed: true };
    }),
    uploadGpx: vi.fn(async () => ({ uploadId: 1, points: 0, fileSizeBytes: 0 })),
    listGpxCoordinates: vi.fn(async () => [])
  };
}

function buildApp() {
  clearModule(activitiesRoutesPath);
  clearModule(activitiesServicePath);

  setModuleMock(poolModulePath, { pool: { query: vi.fn(async () => [[]]) } });
  setModuleMock(auditLogPath, { writeAuditEvent: vi.fn() });
  setModuleMock(activitiesServicePath, buildActivitiesServiceMock());

  const activitiesRoutes = require("../src/modules/activities/activities.routes");

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
  app.use(activitiesRoutes.routes());
  app.use(activitiesRoutes.allowedMethods());
  return app;
}

describe("Activities IDOR / authorization", () => {
  afterAll(() => {
    clearModule(poolModulePath);
    clearModule(activitiesRoutesPath);
    clearModule(activitiesServicePath);
    clearModule(auditLogPath);
  });

  test("unauthenticated GET /activities returns 401", async () => {
    const app = buildApp();
    const res = await request(app.callback()).get("/api/v1/activities");
    expect(res.status).toBe(401);
  });

  test("owner can GET /activities/:id", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/activities/1")
      .set("x-test-user-id", String(OWNER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.user_id).toBe(OWNER_ID);
  });

  test("cross-user GET /activities/:id returns 404", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/activities/1")
      .set("x-test-user-id", String(OTHER_USER_ID));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ACTIVITY_NOT_FOUND");
  });

  test("cross-user DELETE /activities/:id returns 404", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .delete("/api/v1/activities/1")
      .set("x-test-user-id", String(OTHER_USER_ID));
    expect(res.status).toBe(404);
  });

  test("cross-user PATCH /activities/:id returns 404", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .patch("/api/v1/activities/1")
      .set("x-test-user-id", String(OTHER_USER_ID))
      .send({ notes: "hacked" });
    expect(res.status).toBe(404);
  });
});
