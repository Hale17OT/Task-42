const { describeDb, unauth, loginAsAthlete, loginAsAdmin } = require("./helpers/integration-helpers");

describeDb("Users endpoints", () => {
  describe("GET /api/v1/users/me", () => {
    test("401 when not authenticated", async () => {
      const res = await unauth().get("/api/v1/users/me");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });

    test("200 returns current user data for regular user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/users/me");
      expect(res.status).toBe(200);
      expect(res.body.data.username).toBe("athlete1");
      expect(res.body.data.roles).toContain("user");
    });

    test("200 returns current user data with admin role for admin", async () => {
      const agent = await loginAsAdmin();
      const res = await agent.get("/api/v1/users/me");
      expect(res.status).toBe(200);
      expect(res.body.data.roles).toContain("admin");
    });
  });
});
