const { describeDb, unauth } = require("./helpers/integration-helpers");

describeDb("Health + API meta endpoints", () => {
  test("GET /health returns 200 with ok status", async () => {
    const res = await unauth().get("/health");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("ok");
  });

  test("GET /api returns 200 with foundation message", async () => {
    const res = await unauth().get("/api");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.message).toBe("string");
  });

  test("GET unknown route returns 404", async () => {
    const res = await unauth().get("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
