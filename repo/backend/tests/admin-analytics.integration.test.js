const { describeDb, pool, unauth, loginAsAthlete, loginAsCoach, loginAsSupport, loginAsAdmin } = require("./helpers/integration-helpers");

describeDb("Admin analytics endpoints", () => {
  describe("GET /dashboard", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/admin/analytics/dashboard");
      expect(res.status).toBe(401);
    });
    test("403 regular user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/admin/analytics/dashboard");
      expect(res.status).toBe(403);
    });
    test("403 coach", async () => {
      const coach = await loginAsCoach();
      const res = await coach.get("/api/v1/admin/analytics/dashboard");
      expect(res.status).toBe(403);
    });
    test("200 support", async () => {
      const supp = await loginAsSupport();
      const res = await supp.get("/api/v1/admin/analytics/dashboard");
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });
    test("200 admin", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/analytics/dashboard");
      expect(res.status).toBe(200);
    });
  });

  describe("GET /report", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/admin/analytics/report?report=enrollment_funnel");
      expect(res.status).toBe(401);
    });
    test("400 invalid report type", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/analytics/report?report=bogus");
      expect(res.status).toBe(400);
    });
    test("200 enrollment_funnel", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/analytics/report?report=enrollment_funnel");
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });
    test("200 course_popularity", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/analytics/report?report=course_popularity");
      expect(res.status).toBe(200);
    });
    test("200 renewal_rates", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/analytics/report?report=renewal_rates");
      expect(res.status).toBe(200);
    });
    test("200 refund_rates", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/analytics/report?report=refund_rates");
      expect(res.status).toBe(200);
    });
    test("200 channel_performance", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/analytics/report?report=channel_performance");
      expect(res.status).toBe(200);
    });
    test("200 instructor_utilization", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/analytics/report?report=instructor_utilization");
      expect(res.status).toBe(200);
    });
    test("200 location_revenue_cost", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/analytics/report?report=location_revenue_cost");
      expect(res.status).toBe(200);
    });
  });

  describe("POST /export", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().post("/api/v1/admin/analytics/export").send({});
      expect(res.status).toBe(401);
    });
    test("403 regular user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/admin/analytics/export").send({ report: "enrollment_funnel" });
      expect(res.status).toBe(403);
    });
    test("400 invalid report", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.post("/api/v1/admin/analytics/export").send({ report: "bogus" });
      expect(res.status).toBe(400);
    });
    test("200 CSV response and access log created", async () => {
      const admin = await loginAsAdmin();
      const before = await pool.query("SELECT COUNT(*) AS c FROM analytics_export_access_logs");
      const res = await admin.post("/api/v1/admin/analytics/export").send({ report: "enrollment_funnel" });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain("attachment");

      const after = await pool.query("SELECT COUNT(*) AS c FROM analytics_export_access_logs");
      expect(after[0][0].c).toBeGreaterThan(before[0][0].c);
    });
  });

  describe("GET /export-logs", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/admin/analytics/export-logs");
      expect(res.status).toBe(401);
    });
    test("403 regular user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/admin/analytics/export-logs");
      expect(res.status).toBe(403);
    });
    test("200 lists logs", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/analytics/export-logs?limit=10");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
    test("400 invalid limit", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/analytics/export-logs?limit=-1");
      expect(res.status).toBe(400);
    });
  });
});
