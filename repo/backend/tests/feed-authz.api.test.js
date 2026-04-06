const request = require("supertest");
const app = require("../src/app");

describe("Feed route authorization (hermetic)", () => {
  test("unauthenticated GET /feed returns 401", async () => {
    const res = await request(app.callback()).get("/api/v1/feed?limit=1");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  test("unauthenticated GET /feed/preferences returns 401", async () => {
    const res = await request(app.callback()).get("/api/v1/feed/preferences");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  test("unauthenticated PUT /feed/preferences returns 401", async () => {
    const res = await request(app.callback())
      .put("/api/v1/feed/preferences")
      .send({ preferredSports: ["running"], includeTrainingUpdates: true, includeCourseUpdates: true, includeNews: true });
    expect(res.status).toBe(401);
  });

  test("unauthenticated POST /feed/actions returns 401", async () => {
    const res = await request(app.callback())
      .post("/api/v1/feed/actions")
      .send({ action: "clicked", itemType: "news", similarityKey: "test" });
    expect(res.status).toBe(401);
  });
});
