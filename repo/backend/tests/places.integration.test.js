const { describeDb, pool, unauth, unique, loginAsAthlete, loginAsCoach, getUserId } = require("./helpers/integration-helpers");

describeDb("Places endpoints", () => {
  describe("GET /api/v1/places", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/places");
      expect(res.status).toBe(401);
    });

    test("200 returns places scoped to user only", async () => {
      const agent = await loginAsAthlete();
      const athleteId = await getUserId("athlete1");
      await pool.query("DELETE FROM saved_places WHERE user_id = ?", [athleteId]);

      const label = unique("Home");
      await pool.query("INSERT INTO saved_places (user_id, label, location_text) VALUES (?, ?, ?)", [athleteId, label, "123 Main St"]);

      const res = await agent.get("/api/v1/places");
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].label).toBe(label);

      await pool.query("DELETE FROM saved_places WHERE user_id = ?", [athleteId]);
    });
  });

  describe("POST /api/v1/places", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().post("/api/v1/places").send({ label: "X", locationText: "Y" });
      expect(res.status).toBe(401);
    });

    test("400 missing label", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/places").send({ locationText: "Y" });
      expect(res.status).toBe(400);
    });

    test("400 invalid latitude", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/places").send({ label: "x", locationText: "y", latitude: 200 });
      expect(res.status).toBe(400);
    });

    test("201 persists place row", async () => {
      const agent = await loginAsAthlete();
      const label = unique("place");
      const res = await agent.post("/api/v1/places").send({ label, locationText: "Somewhere", latitude: 40.7, longitude: -74.0 });
      expect(res.status).toBe(201);
      expect(res.body.data.label).toBe(label);

      const [rows] = await pool.query("SELECT * FROM saved_places WHERE id = ?", [res.body.data.id]);
      expect(rows.length).toBe(1);
      expect(Number(rows[0].latitude)).toBeCloseTo(40.7, 1);

      await pool.query("DELETE FROM saved_places WHERE id = ?", [res.body.data.id]);
    });

    test("isDefault=true clears previous defaults for the user", async () => {
      const agent = await loginAsAthlete();
      const athleteId = await getUserId("athlete1");
      const l1 = unique("p1");
      const l2 = unique("p2");

      const r1 = await agent.post("/api/v1/places").send({ label: l1, locationText: "A", isDefault: true });
      const r2 = await agent.post("/api/v1/places").send({ label: l2, locationText: "B", isDefault: true });

      const [rows] = await pool.query(
        "SELECT id, is_default FROM saved_places WHERE user_id = ? AND id IN (?, ?)",
        [athleteId, r1.body.data.id, r2.body.data.id]
      );
      const first = rows.find((r) => r.id === r1.body.data.id);
      const second = rows.find((r) => r.id === r2.body.data.id);
      expect(first.is_default).toBe(0);
      expect(second.is_default).toBe(1);

      await pool.query("DELETE FROM saved_places WHERE id IN (?, ?)", [r1.body.data.id, r2.body.data.id]);
    });
  });

  describe("PATCH /api/v1/places/:placeId", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().patch("/api/v1/places/1").send({ label: "new" });
      expect(res.status).toBe(401);
    });

    test("400 non-numeric placeId", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.patch("/api/v1/places/abc").send({ label: "x" });
      expect(res.status).toBe(400);
    });

    test("404 non-existent place", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.patch("/api/v1/places/999999").send({ label: "x" });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("PLACE_NOT_FOUND");
    });

    test("404 cross-user (IDOR)", async () => {
      const coachId = await getUserId("coach1");
      const [ins] = await pool.query("INSERT INTO saved_places (user_id, label, location_text) VALUES (?, ?, ?)", [coachId, unique("CoachPlace"), "X"]);
      try {
        const athleteAgent = await loginAsAthlete();
        const res = await athleteAgent.patch(`/api/v1/places/${ins.insertId}`).send({ label: "hacked" });
        expect(res.status).toBe(404);

        const [rows] = await pool.query("SELECT label FROM saved_places WHERE id = ?", [ins.insertId]);
        expect(rows[0].label).not.toBe("hacked");
      } finally {
        await pool.query("DELETE FROM saved_places WHERE id = ?", [ins.insertId]);
      }
    });

    test("200 owner updates label", async () => {
      const agent = await loginAsAthlete();
      const r = await agent.post("/api/v1/places").send({ label: unique("p"), locationText: "X" });
      const res = await agent.patch(`/api/v1/places/${r.body.data.id}`).send({ label: "Updated" });
      expect(res.status).toBe(200);
      expect(res.body.data.label).toBe("Updated");
      await pool.query("DELETE FROM saved_places WHERE id = ?", [r.body.data.id]);
    });
  });

  describe("DELETE /api/v1/places/:placeId", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().delete("/api/v1/places/1");
      expect(res.status).toBe(401);
    });

    test("404 non-existent", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.delete("/api/v1/places/999999");
      expect(res.status).toBe(404);
    });

    test("404 cross-user (IDOR)", async () => {
      const coachId = await getUserId("coach1");
      const [ins] = await pool.query("INSERT INTO saved_places (user_id, label, location_text) VALUES (?, ?, ?)", [coachId, unique("CP"), "x"]);
      try {
        const athleteAgent = await loginAsAthlete();
        const res = await athleteAgent.delete(`/api/v1/places/${ins.insertId}`);
        expect(res.status).toBe(404);

        const [rows] = await pool.query("SELECT id FROM saved_places WHERE id = ?", [ins.insertId]);
        expect(rows.length).toBe(1);
      } finally {
        await pool.query("DELETE FROM saved_places WHERE id = ?", [ins.insertId]);
      }
    });

    test("200 owner deletes place", async () => {
      const agent = await loginAsAthlete();
      const r = await agent.post("/api/v1/places").send({ label: unique("p"), locationText: "X" });
      const res = await agent.delete(`/api/v1/places/${r.body.data.id}`);
      expect(res.status).toBe(200);
      const [rows] = await pool.query("SELECT id FROM saved_places WHERE id = ?", [r.body.data.id]);
      expect(rows.length).toBe(0);
    });
  });
});
