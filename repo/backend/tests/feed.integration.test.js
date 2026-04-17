const { describeDb, pool, unauth, loginAsAthlete, getUserId } = require("./helpers/integration-helpers");

describeDb("Feed endpoints", () => {
  describe("GET /api/v1/feed", () => {
    test("401 when unauthenticated", async () => {
      const res = await unauth().get("/api/v1/feed?limit=5");
      expect(res.status).toBe(401);
    });

    test("400 when limit is non-numeric", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/feed?limit=not-a-number");
      expect(res.status).toBe(400);
    });

    test("400 when limit exceeds 100", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/feed?limit=200");
      expect(res.status).toBe(400);
    });

    test("200 returns array for authenticated user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/feed?limit=10");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test("course updates are scoped to requester", async () => {
      const athleteId = await getUserId("athlete1");
      const [rows] = await pool.query(
        `SELECT o.user_id FROM orders o
         JOIN feed_impression_history h ON h.source_kind = 'course_update'
         WHERE o.id = h.content_item_id AND h.user_id = ?
         LIMIT 5`,
        [athleteId]
      );
      for (const row of rows) {
        expect(row.user_id).toBe(athleteId);
      }
    });
  });

  describe("POST /api/v1/feed/actions", () => {
    test("401 when unauthenticated", async () => {
      const res = await unauth().post("/api/v1/feed/actions").send({ action: "clicked", itemType: "news", similarityKey: "k" });
      expect(res.status).toBe(401);
    });

    test("400 on invalid action value", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/feed/actions").send({ action: "liked", itemType: "news", similarityKey: "k" });
      expect(res.status).toBe(400);
    });

    test("400 on missing required fields", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/feed/actions").send({ action: "clicked" });
      expect(res.status).toBe(400);
    });

    test("200 on valid clicked action persists impression", async () => {
      const agent = await loginAsAthlete();
      const key = `test-sim-${Date.now()}`;
      const res = await agent.post("/api/v1/feed/actions").send({
        action: "clicked",
        itemType: "news",
        similarityKey: key
      });
      expect(res.status).toBe(200);
      expect(res.body.data.accepted).toBe(true);

      const athleteId = await getUserId("athlete1");
      const [rows] = await pool.query(
        "SELECT * FROM feed_impression_history WHERE user_id = ? AND similarity_key = ? LIMIT 1",
        [athleteId, key]
      );
      expect(rows.length).toBe(1);
      expect(rows[0].action_taken).toBe("clicked");

      await pool.query("DELETE FROM feed_impression_history WHERE similarity_key = ?", [key]);
    });

    test("block_author action appends to blocked_authors in preferences", async () => {
      const agent = await loginAsAthlete();
      const author = `blockauthor-${Date.now()}`;
      const res = await agent.post("/api/v1/feed/actions").send({
        action: "block_author",
        itemType: "news",
        similarityKey: `sk-${Date.now()}`,
        author
      });
      expect(res.status).toBe(200);

      const athleteId = await getUserId("athlete1");
      const [prefs] = await pool.query("SELECT blocked_authors FROM user_feed_preferences WHERE user_id = ?", [athleteId]);
      const raw = prefs[0].blocked_authors;
      const list = typeof raw === "string" ? JSON.parse(raw) : raw;
      expect(list).toContain(author);

      const filtered = list.filter((a) => a !== author);
      await pool.query("UPDATE user_feed_preferences SET blocked_authors = ? WHERE user_id = ?", [JSON.stringify(filtered), athleteId]);
    });
  });

  describe("GET /api/v1/feed/preferences", () => {
    test("401 when unauthenticated", async () => {
      const res = await unauth().get("/api/v1/feed/preferences");
      expect(res.status).toBe(401);
    });

    test("200 returns preferences with expected fields", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/feed/preferences");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("preferredSports");
      expect(res.body.data).toHaveProperty("includeTrainingUpdates");
      expect(res.body.data).toHaveProperty("includeCourseUpdates");
      expect(res.body.data).toHaveProperty("includeNews");
    });
  });

  describe("PUT /api/v1/feed/preferences", () => {
    test("401 when unauthenticated", async () => {
      const res = await unauth().put("/api/v1/feed/preferences").send({});
      expect(res.status).toBe(401);
    });

    test("400 when preferredSports is not an array", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.put("/api/v1/feed/preferences").send({ preferredSports: "running" });
      expect(res.status).toBe(400);
    });

    test("200 persists preferences", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.put("/api/v1/feed/preferences").send({
        preferredSports: ["running", "cycling"],
        includeTrainingUpdates: false,
        includeCourseUpdates: true,
        includeNews: true
      });
      expect(res.status).toBe(200);
      expect(res.body.data.preferredSports).toEqual(["running", "cycling"]);
      expect(res.body.data.includeTrainingUpdates).toBe(false);

      // reset
      await agent.put("/api/v1/feed/preferences").send({
        preferredSports: ["running"],
        includeTrainingUpdates: true,
        includeCourseUpdates: true,
        includeNews: true
      });
    });
  });
});
