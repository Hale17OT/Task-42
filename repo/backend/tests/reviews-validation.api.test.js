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
const reviewsRoutesPath = require.resolve("../src/modules/reviews/reviews.routes");
const reviewsServicePath = require.resolve("../src/modules/reviews/reviews.service");

function buildApp() {
  clearModule(reviewsRoutesPath);
  clearModule(reviewsServicePath);

  setModuleMock(poolModulePath, { pool: { query: vi.fn(async () => [[]]) } });
  setModuleMock(reviewsServicePath, {
    createReview: vi.fn(async () => ({ id: 1 })),
    addFollowup: vi.fn(async () => ({ id: 1 })),
    listUserReviews: vi.fn(async () => []),
    getReviewDetail: vi.fn(async () => ({ id: 1 })),
    createAppeal: vi.fn(async () => ({ id: 1 })),
    uploadReviewImage: vi.fn(async () => ({ id: 1 })),
    getReviewImage: vi.fn(async () => ({ id: 1, file_path: "/tmp/x.jpg", mime_type: "image/jpeg" }))
  });

  const reviewsRoutes = require("../src/modules/reviews/reviews.routes");

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
  app.use(reviewsRoutes.routes());
  app.use(reviewsRoutes.allowedMethods());
  return app;
}

describe("Reviews validation (hermetic)", () => {
  afterAll(() => {
    clearModule(poolModulePath);
    clearModule(reviewsRoutesPath);
    clearModule(reviewsServicePath);
  });

  test("POST /reviews with missing required fields returns 400", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .post("/api/v1/reviews")
      .set("x-test-user-id", "10")
      .send({ rating: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("POST /reviews with invalid rating returns 400", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .post("/api/v1/reviews")
      .set("x-test-user-id", "10")
      .send({ orderId: 1, rating: 10, reviewText: "great" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("POST /reviews/:id/appeals with empty reason returns 400", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .post("/api/v1/reviews/1/appeals")
      .set("x-test-user-id", "10")
      .send({ reason: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("POST /reviews unauthenticated returns 401", async () => {
    const app = buildApp();
    const res = await request(app.callback())
      .post("/api/v1/reviews")
      .send({ orderId: 1, rating: 5, reviewText: "test" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
