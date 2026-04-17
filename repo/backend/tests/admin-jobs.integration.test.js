const { describeDb, unauth, loginAsAthlete, loginAsCoach, loginAsSupport, loginAsAdmin } = require("./helpers/integration-helpers");

describeDb("Admin debug/job endpoints", () => {
  describe("GET /api/v1/admin/test", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/admin/test");
      expect(res.status).toBe(401);
    });
    test("403 regular user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/admin/test");
      expect(res.status).toBe(403);
    });
    test("403 coach", async () => {
      const coach = await loginAsCoach();
      const res = await coach.get("/api/v1/admin/test");
      expect(res.status).toBe(403);
    });
    test("403 support", async () => {
      const supp = await loginAsSupport();
      const res = await supp.get("/api/v1/admin/test");
      expect(res.status).toBe(403);
    });
    test("200 admin", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/test");
      expect(res.status).toBe(200);
      expect(res.body.data.ok).toBe(true);
      expect(res.body.data.actor.username).toBe("admin");
    });
  });

  describe("POST /api/v1/admin/jobs/process-once", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().post("/api/v1/admin/jobs/process-once");
      expect(res.status).toBe(401);
    });
    test("403 regular user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/admin/jobs/process-once");
      expect(res.status).toBe(403);
    });
    test("200 admin processes one queue tick", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.post("/api/v1/admin/jobs/process-once");
      expect(res.status).toBe(200);
      expect(res.body.data.processed).toBe(true);
    }, 15000);
  });
});
