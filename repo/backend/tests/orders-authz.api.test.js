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
const ordersRoutesPath = require.resolve("../src/modules/orders/orders.routes");
const ordersServicePath = require.resolve("../src/modules/orders/orders.service");
const auditLogPath = require.resolve("../src/services/audit-log");

const OWNER_ID = 10;
const OTHER_USER_ID = 99;

function buildOrdersServiceMock() {
  const ApiError = require("../src/errors/api-error");
  return {
    createOrder: vi.fn(async () => ({ id: 1 })),
    listOrdersForUser: vi.fn(async ({ userId }) => {
      if (userId === OWNER_ID) return [{ id: 1, user_id: OWNER_ID, order_status: "paid" }];
      return [];
    }),
    getOrderForUser: vi.fn(async ({ orderId, userId, roles }) => {
      const isStaff = roles.some((r) => ["admin", "support", "coach"].includes(r));
      if (userId !== OWNER_ID && !isStaff) {
        throw new ApiError(404, "ORDER_NOT_FOUND", "Order not found");
      }
      return { id: orderId, user_id: OWNER_ID, order_status: "paid" };
    }),
    markOrderCompleted: vi.fn(async () => ({ id: 1, order_status: "completed" }))
  };
}

function buildApp() {
  clearModule(ordersRoutesPath);
  clearModule(ordersServicePath);

  setModuleMock(poolModulePath, { pool: { query: vi.fn(async () => [[]]) } });
  setModuleMock(auditLogPath, { writeAuditEvent: vi.fn() });
  setModuleMock(ordersServicePath, buildOrdersServiceMock());

  const ordersRoutes = require("../src/modules/orders/orders.routes");

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
        roles: (ctx.get("x-test-user-roles") || "user")
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean)
      };
    }
    await next();
  });
  app.use(ordersRoutes.routes());
  app.use(ordersRoutes.allowedMethods());
  return app;
}

describe("Orders IDOR / authorization", () => {
  afterAll(() => {
    clearModule(poolModulePath);
    clearModule(ordersRoutesPath);
    clearModule(ordersServicePath);
    clearModule(auditLogPath);
  });

  test("unauthenticated GET /orders returns 401", async () => {
    const app = buildApp();
    const res = await request(app.callback()).get("/api/v1/orders");
    expect(res.status).toBe(401);
  });

  test("unauthenticated GET /orders/:id returns 401", async () => {
    const app = buildApp();
    const res = await request(app.callback()).get("/api/v1/orders/1");
    expect(res.status).toBe(401);
  });

  test("owner GET /orders/:id returns 200", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/orders/1")
      .set("x-test-user-id", String(OWNER_ID))
      .set("x-test-user-roles", "user");
    expect(res.status).toBe(200);
    expect(res.body.data.user_id).toBe(OWNER_ID);
  });

  test("cross-user GET /orders/:id returns 404", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/orders/1")
      .set("x-test-user-id", String(OTHER_USER_ID))
      .set("x-test-user-roles", "user");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
  });

  test("staff can access any order", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .get("/api/v1/orders/1")
      .set("x-test-user-id", String(OTHER_USER_ID))
      .set("x-test-user-roles", "support");
    expect(res.status).toBe(200);
  });

  test("regular user POST /orders/:id/complete returns 403", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .post("/api/v1/orders/1/complete")
      .set("x-test-user-id", String(OWNER_ID))
      .set("x-test-user-roles", "user");
    expect(res.status).toBe(403);
  });
});
