const { describeDb, pool, unauth } = require("./helpers/integration-helpers");

describeDb("Catalog endpoints", () => {
  describe("GET /api/v1/catalog", () => {
    test("200 returns active course/service listings (public)", async () => {
      const res = await unauth().get("/api/v1/catalog");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test("only returns items with status='active'", async () => {
      const res = await unauth().get("/api/v1/catalog");
      for (const item of res.body.data) {
        expect(item.status).toBe("active");
      }
    });

    test("response items include required fields", async () => {
      const res = await unauth().get("/api/v1/catalog");
      if (res.body.data.length > 0) {
        const item = res.body.data[0];
        expect(item).toHaveProperty("id");
        expect(item).toHaveProperty("kind");
        expect(item).toHaveProperty("title");
        expect(item).toHaveProperty("status");
      }
    });

    test("inactive items are excluded from listing", async () => {
      // Mark an item inactive temporarily and verify it disappears
      const [active] = await pool.query("SELECT id FROM courses_services WHERE status = 'active' LIMIT 1");
      if (!active.length) return;
      const id = active[0].id;
      await pool.query("UPDATE courses_services SET status = 'retired' WHERE id = ?", [id]);
      try {
        const res = await unauth().get("/api/v1/catalog");
        expect(res.body.data.find((r) => r.id === id)).toBeUndefined();
      } finally {
        await pool.query("UPDATE courses_services SET status = 'active' WHERE id = ?", [id]);
      }
    });
  });
});
