const { describeDb, pool, unauth, unique, loginAsAthlete, loginAsCoach, getUserId } = require("./helpers/integration-helpers");

const SAMPLE_GPX = `<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="40.0" lon="-73.0"><ele>10</ele><time>2024-01-01T00:00:00Z</time></trkpt>
    <trkpt lat="40.01" lon="-73.01"><ele>12</ele><time>2024-01-01T00:00:05Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

describeDb("Activities endpoints", () => {
  describe("GET /api/v1/activities", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/activities");
      expect(res.status).toBe(401);
    });

    test("200 scoped to user", async () => {
      const agent = await loginAsAthlete();
      const athleteId = await getUserId("athlete1");
      await pool.query("DELETE FROM activities WHERE user_id = ?", [athleteId]);

      const [ins] = await pool.query(
        `INSERT INTO activities (user_id, activity_type, duration_seconds, distance_miles, status)
         VALUES (?, 'running', 1800, 3.5, 'published')`,
        [athleteId]
      );

      const res = await agent.get("/api/v1/activities");
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe(ins.insertId);

      await pool.query("DELETE FROM activities WHERE id = ?", [ins.insertId]);
    });

    test("archived activities are excluded from listing", async () => {
      const agent = await loginAsAthlete();
      const athleteId = await getUserId("athlete1");
      const [ins] = await pool.query(
        `INSERT INTO activities (user_id, activity_type, duration_seconds, distance_miles, status)
         VALUES (?, 'running', 1000, 2.0, 'archived')`,
        [athleteId]
      );
      const res = await agent.get("/api/v1/activities");
      expect(res.body.data.find((a) => a.id === ins.insertId)).toBeUndefined();
      await pool.query("DELETE FROM activities WHERE id = ?", [ins.insertId]);
    });
  });

  describe("POST /api/v1/activities", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().post("/api/v1/activities").send({});
      expect(res.status).toBe(401);
    });

    test("400 missing required fields", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/activities").send({ activityType: "running" });
      expect(res.status).toBe(400);
    });

    test("400 invalid activityType enum", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/activities").send({
        activityType: "swimming",
        durationSeconds: 1800,
        distanceMiles: 3.5
      });
      expect(res.status).toBe(400);
    });

    test("400 when distance is negative", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/activities").send({
        activityType: "running",
        durationSeconds: 1800,
        distanceMiles: -1
      });
      expect(res.status).toBe(400);
    });

    test("201 creates activity with tags", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/activities").send({
        activityType: "running",
        durationSeconds: 1800,
        distanceMiles: 3.5,
        tags: ["morning", "trail"]
      });
      expect(res.status).toBe(201);
      expect(res.body.data.tags).toEqual(expect.arrayContaining(["morning", "trail"]));

      const [tagRows] = await pool.query("SELECT tag FROM activity_tags WHERE activity_id = ?", [res.body.data.id]);
      expect(tagRows.map((t) => t.tag).sort()).toEqual(["morning", "trail"]);

      await pool.query("DELETE FROM activity_tags WHERE activity_id = ?", [res.body.data.id]);
      await pool.query("DELETE FROM activities WHERE id = ?", [res.body.data.id]);
    });

    test("400 when savedPlaceId belongs to another user", async () => {
      const agent = await loginAsAthlete();
      const coachId = await getUserId("coach1");
      const [ins] = await pool.query("INSERT INTO saved_places (user_id, label, location_text) VALUES (?, ?, ?)", [coachId, unique("cp"), "x"]);
      try {
        const res = await agent.post("/api/v1/activities").send({
          activityType: "running",
          durationSeconds: 1800,
          distanceMiles: 3.5,
          savedPlaceId: ins.insertId
        });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("INVALID_SAVED_PLACE");
      } finally {
        await pool.query("DELETE FROM saved_places WHERE id = ?", [ins.insertId]);
      }
    });
  });

  describe("GET /api/v1/activities/:activityId", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/activities/1");
      expect(res.status).toBe(401);
    });

    test("400 non-numeric id", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/activities/abc");
      expect(res.status).toBe(400);
    });

    test("404 when activity doesn't exist", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/activities/999999");
      expect(res.status).toBe(404);
    });

    test("404 when accessing cross-user activity (IDOR)", async () => {
      const coachId = await getUserId("coach1");
      const [ins] = await pool.query(
        `INSERT INTO activities (user_id, activity_type, duration_seconds, distance_miles, status)
         VALUES (?, 'running', 1000, 2.0, 'published')`,
        [coachId]
      );
      try {
        const athleteAgent = await loginAsAthlete();
        const res = await athleteAgent.get(`/api/v1/activities/${ins.insertId}`);
        expect(res.status).toBe(404);
      } finally {
        await pool.query("DELETE FROM activities WHERE id = ?", [ins.insertId]);
      }
    });

    test("200 owner can access including derived metrics", async () => {
      const agent = await loginAsAthlete();
      const created = await agent.post("/api/v1/activities").send({
        activityType: "running",
        durationSeconds: 1800,
        distanceMiles: 3.5
      });
      const res = await agent.get(`/api/v1/activities/${created.body.data.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.derived).toBeDefined();
      expect(res.body.data.derived.avgSpeedMph).toBeGreaterThan(0);

      await pool.query("DELETE FROM activities WHERE id = ?", [created.body.data.id]);
    });
  });

  describe("PATCH /api/v1/activities/:activityId", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().patch("/api/v1/activities/1").send({ notes: "x" });
      expect(res.status).toBe(401);
    });

    test("404 cross-user (IDOR)", async () => {
      const coachId = await getUserId("coach1");
      const [ins] = await pool.query(
        `INSERT INTO activities (user_id, activity_type, duration_seconds, distance_miles, status)
         VALUES (?, 'running', 1000, 2.0, 'published')`,
        [coachId]
      );
      try {
        const athleteAgent = await loginAsAthlete();
        const res = await athleteAgent.patch(`/api/v1/activities/${ins.insertId}`).send({ notes: "hacked" });
        expect(res.status).toBe(404);
        const [rows] = await pool.query("SELECT notes FROM activities WHERE id = ?", [ins.insertId]);
        expect(rows[0].notes).not.toBe("hacked");
      } finally {
        await pool.query("DELETE FROM activities WHERE id = ?", [ins.insertId]);
      }
    });

    test("200 owner can update notes and tags", async () => {
      const agent = await loginAsAthlete();
      const created = await agent.post("/api/v1/activities").send({
        activityType: "running",
        durationSeconds: 1800,
        distanceMiles: 3.5,
        tags: ["a"]
      });
      const res = await agent.patch(`/api/v1/activities/${created.body.data.id}`).send({ notes: "updated", tags: ["b", "c"] });
      expect(res.status).toBe(200);
      expect(res.body.data.notes).toBe("updated");
      expect(res.body.data.tags.sort()).toEqual(["b", "c"]);

      await pool.query("DELETE FROM activity_tags WHERE activity_id = ?", [created.body.data.id]);
      await pool.query("DELETE FROM activities WHERE id = ?", [created.body.data.id]);
    });
  });

  describe("DELETE /api/v1/activities/:activityId", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().delete("/api/v1/activities/1");
      expect(res.status).toBe(401);
    });

    test("404 cross-user", async () => {
      const coachId = await getUserId("coach1");
      const [ins] = await pool.query(
        `INSERT INTO activities (user_id, activity_type, duration_seconds, distance_miles, status)
         VALUES (?, 'running', 1000, 2.0, 'published')`,
        [coachId]
      );
      try {
        const athleteAgent = await loginAsAthlete();
        const res = await athleteAgent.delete(`/api/v1/activities/${ins.insertId}`);
        expect(res.status).toBe(404);

        const [rows] = await pool.query("SELECT status FROM activities WHERE id = ?", [ins.insertId]);
        expect(rows[0].status).toBe("published");
      } finally {
        await pool.query("DELETE FROM activities WHERE id = ?", [ins.insertId]);
      }
    });

    test("200 archives (soft-deletes) owned activity", async () => {
      const agent = await loginAsAthlete();
      const created = await agent.post("/api/v1/activities").send({
        activityType: "running",
        durationSeconds: 1800,
        distanceMiles: 3.5
      });
      const res = await agent.delete(`/api/v1/activities/${created.body.data.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.removed).toBe(true);

      const [rows] = await pool.query("SELECT status FROM activities WHERE id = ?", [created.body.data.id]);
      expect(rows[0].status).toBe("archived");

      await pool.query("DELETE FROM activities WHERE id = ?", [created.body.data.id]);
    });
  });

  describe("POST /api/v1/activities/:activityId/gpx", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().post("/api/v1/activities/1/gpx").send({});
      expect(res.status).toBe(401);
    });

    test("400 missing required fields", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/activities/1/gpx").send({ fileName: "x.gpx" });
      expect(res.status).toBe(400);
    });

    test("404 when activity is not owned", async () => {
      const agent = await loginAsAthlete();
      const coachId = await getUserId("coach1");
      const [ins] = await pool.query(
        `INSERT INTO activities (user_id, activity_type, duration_seconds, distance_miles, status)
         VALUES (?, 'running', 1000, 2.0, 'published')`,
        [coachId]
      );
      try {
        const payload = {
          fileName: "test.gpx",
          mimeType: "application/gpx+xml",
          sizeBytes: SAMPLE_GPX.length,
          base64Data: Buffer.from(SAMPLE_GPX).toString("base64")
        };
        const res = await agent.post(`/api/v1/activities/${ins.insertId}/gpx`).send(payload);
        expect(res.status).toBe(404);
      } finally {
        await pool.query("DELETE FROM activities WHERE id = ?", [ins.insertId]);
      }
    });

    test("201 uploads and parses GPX; coordinates become retrievable", async () => {
      const agent = await loginAsAthlete();
      const created = await agent.post("/api/v1/activities").send({
        activityType: "running",
        durationSeconds: 1800,
        distanceMiles: 3.5
      });
      const activityId = created.body.data.id;
      const payload = {
        fileName: "test.gpx",
        mimeType: "application/gpx+xml",
        sizeBytes: SAMPLE_GPX.length,
        base64Data: Buffer.from(SAMPLE_GPX).toString("base64")
      };
      const res = await agent.post(`/api/v1/activities/${activityId}/gpx`).send(payload);
      expect(res.status).toBe(201);
      expect(res.body.data.points).toBe(2);

      const coordsRes = await agent.get(`/api/v1/activities/${activityId}/coordinates`);
      expect(coordsRes.status).toBe(200);
      expect(coordsRes.body.data.length).toBe(2);

      await pool.query("DELETE FROM gpx_points WHERE gpx_upload_id = ?", [res.body.data.uploadId]);
      await pool.query("DELETE FROM gpx_uploads WHERE id = ?", [res.body.data.uploadId]);
      await pool.query("DELETE FROM activities WHERE id = ?", [activityId]);
    });
  });

  describe("GET /api/v1/activities/:activityId/coordinates", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/activities/1/coordinates");
      expect(res.status).toBe(401);
    });

    test("200 empty array when no GPX uploaded", async () => {
      const agent = await loginAsAthlete();
      const created = await agent.post("/api/v1/activities").send({
        activityType: "running",
        durationSeconds: 1800,
        distanceMiles: 3.5
      });
      const res = await agent.get(`/api/v1/activities/${created.body.data.id}/coordinates`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);

      await pool.query("DELETE FROM activities WHERE id = ?", [created.body.data.id]);
    });

    test("returns empty for cross-user (scoped by owner)", async () => {
      const coachId = await getUserId("coach1");
      const [ins] = await pool.query(
        `INSERT INTO activities (user_id, activity_type, duration_seconds, distance_miles, status)
         VALUES (?, 'running', 1000, 2.0, 'published')`,
        [coachId]
      );
      try {
        const athleteAgent = await loginAsAthlete();
        const res = await athleteAgent.get(`/api/v1/activities/${ins.insertId}/coordinates`);
        // Coordinates are scoped by user_id in query; cross-user returns []
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
      } finally {
        await pool.query("DELETE FROM activities WHERE id = ?", [ins.insertId]);
      }
    });
  });
});
