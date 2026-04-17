const { describeDb, pool, unauth, loginAsAthlete, loginAsCoach, getUserId } = require("./helpers/integration-helpers");

describeDb("Follows endpoints", () => {
  describe("GET /api/v1/follows/mine", () => {
    test("401 when unauthenticated", async () => {
      const res = await unauth().get("/api/v1/follows/mine");
      expect(res.status).toBe(401);
    });

    test("200 returns list for authenticated user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/follows/mine");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe("POST /api/v1/follows/:userId", () => {
    test("401 when unauthenticated", async () => {
      const res = await unauth().post("/api/v1/follows/2");
      expect(res.status).toBe(401);
    });

    test("400 when userId is non-numeric", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/follows/notanumber");
      expect(res.status).toBe(400);
    });

    test("201 creates follow row in DB, 200 on duplicate", async () => {
      const agent = await loginAsAthlete();
      const athleteId = await getUserId("athlete1");
      const coachId = await getUserId("coach1");

      await pool.query("DELETE FROM user_follows WHERE follower_user_id = ? AND followed_user_id = ?", [athleteId, coachId]);

      const res1 = await agent.post(`/api/v1/follows/${coachId}`);
      expect(res1.status).toBe(201);

      const [rows] = await pool.query(
        "SELECT id FROM user_follows WHERE follower_user_id = ? AND followed_user_id = ?",
        [athleteId, coachId]
      );
      expect(rows.length).toBe(1);

      const res2 = await agent.post(`/api/v1/follows/${coachId}`);
      expect(res2.status).toBe(200);
      expect(res2.body.data.duplicate).toBe(true);

      await pool.query("DELETE FROM user_follows WHERE id = ?", [rows[0].id]);
    });
  });

  describe("DELETE /api/v1/follows/:userId", () => {
    test("401 when unauthenticated", async () => {
      const res = await unauth().delete("/api/v1/follows/2");
      expect(res.status).toBe(401);
    });

    test("400 on invalid userId param", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.delete("/api/v1/follows/abc");
      expect(res.status).toBe(400);
    });

    test("200 unfollow removes row", async () => {
      const agent = await loginAsAthlete();
      const athleteId = await getUserId("athlete1");
      const coachId = await getUserId("coach1");

      await agent.post(`/api/v1/follows/${coachId}`);
      const res = await agent.delete(`/api/v1/follows/${coachId}`);
      expect(res.status).toBe(200);

      const [rows] = await pool.query(
        "SELECT id FROM user_follows WHERE follower_user_id = ? AND followed_user_id = ?",
        [athleteId, coachId]
      );
      expect(rows.length).toBe(0);
    });
  });

  describe("Self-follow prevention", () => {
    test("400 when user tries to follow self", async () => {
      const agent = await loginAsAthlete();
      const athleteId = await getUserId("athlete1");
      const res = await agent.post(`/api/v1/follows/${athleteId}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_FOLLOW_TARGET");
    });

    test("404 when following non-existent user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post(`/api/v1/follows/9999999`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("USER_NOT_FOUND");
    });
  });

  describe("Tenant isolation", () => {
    test("mine only returns follows from the authenticated user", async () => {
      const athleteAgent = await loginAsAthlete();
      const coachAgent = await loginAsCoach();
      const athleteId = await getUserId("athlete1");
      const coachId = await getUserId("coach1");
      const target = await getUserId("admin");

      await athleteAgent.post(`/api/v1/follows/${target}`);

      const coachMine = await coachAgent.get("/api/v1/follows/mine");
      const [coachFollows] = await pool.query("SELECT followed_user_id FROM user_follows WHERE follower_user_id = ?", [coachId]);
      const coachFollowIds = coachFollows.map((r) => Number(r.followed_user_id));
      for (const item of coachMine.body.data) {
        expect(coachFollowIds).toContain(Number(item.user_id));
      }

      await pool.query("DELETE FROM user_follows WHERE follower_user_id = ? AND followed_user_id = ?", [athleteId, target]);
    });
  });
});
