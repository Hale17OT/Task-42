const { describeDb, pool, unauth, unique, loginAsAthlete, loginAsCoach, loginAsSupport, loginAsAdmin, getUserId } = require("./helpers/integration-helpers");

describeDb("Admin review governance endpoints", () => {
  describe("GET /dimensions", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/admin/review-governance/dimensions");
      expect(res.status).toBe(401);
    });
    test("403 for regular user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/admin/review-governance/dimensions");
      expect(res.status).toBe(403);
    });
    test("403 for support (admin-only)", async () => {
      const supp = await loginAsSupport();
      const res = await supp.get("/api/v1/admin/review-governance/dimensions");
      expect(res.status).toBe(403);
    });
    test("200 for admin", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/review-governance/dimensions");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe("POST /dimensions", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().post("/api/v1/admin/review-governance/dimensions").send({});
      expect(res.status).toBe(401);
    });
    test("400 missing fields", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.post("/api/v1/admin/review-governance/dimensions").send({ keyName: "x" });
      expect(res.status).toBe(400);
    });
    test("201 admin creates dimension persisted in DB", async () => {
      const admin = await loginAsAdmin();
      const keyName = unique("dim").slice(0, 60);
      const res = await admin.post("/api/v1/admin/review-governance/dimensions").send({
        keyName, label: "Test Dimension", weight: 10, isActive: true
      });
      expect(res.status).toBe(201);
      const [rows] = await pool.query("SELECT * FROM review_dimension_configs WHERE key_name = ?", [keyName]);
      expect(rows.length).toBe(1);
      await pool.query("DELETE FROM review_dimension_configs WHERE key_name = ?", [keyName]);
    });
  });

  describe("PATCH /dimensions/:id", () => {
    test("400 non-numeric id", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.patch("/api/v1/admin/review-governance/dimensions/abc").send({ label: "x" });
      expect(res.status).toBe(400);
    });
    test("200 updates dimension", async () => {
      const admin = await loginAsAdmin();
      const keyName = unique("dim").slice(0, 60);
      const create = await admin.post("/api/v1/admin/review-governance/dimensions").send({
        keyName, label: "Original", weight: 5, isActive: true
      });
      const res = await admin.patch(`/api/v1/admin/review-governance/dimensions/${create.body.data.id}`).send({ label: "Renamed" });
      expect(res.status).toBe(200);
      expect(res.body.data.label).toBe("Renamed");
      await pool.query("DELETE FROM review_dimension_configs WHERE id = ?", [create.body.data.id]);
    });
  });

  describe("GET /sensitive-words", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/admin/review-governance/sensitive-words");
      expect(res.status).toBe(401);
    });
    test("403 non-admin", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/admin/review-governance/sensitive-words");
      expect(res.status).toBe(403);
    });
    test("200 admin lists words", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/review-governance/sensitive-words");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe("POST /sensitive-words", () => {
    test("400 missing word", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.post("/api/v1/admin/review-governance/sensitive-words").send({});
      expect(res.status).toBe(400);
    });
    test("201 creates word in DB", async () => {
      const admin = await loginAsAdmin();
      const word = unique("bad");
      const res = await admin.post("/api/v1/admin/review-governance/sensitive-words").send({ word });
      expect(res.status).toBe(201);
      const [rows] = await pool.query("SELECT * FROM sensitive_words WHERE word = ?", [word]);
      expect(rows.length).toBe(1);
      await pool.query("DELETE FROM sensitive_words WHERE word = ?", [word]);
    });
  });

  describe("DELETE /sensitive-words/:id", () => {
    test("400 non-numeric id", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.delete("/api/v1/admin/review-governance/sensitive-words/abc");
      expect(res.status).toBe(400);
    });
    test("200 soft-deletes by setting is_active=0", async () => {
      const admin = await loginAsAdmin();
      const word = unique("rm");
      await admin.post("/api/v1/admin/review-governance/sensitive-words").send({ word });
      const [rows] = await pool.query("SELECT id FROM sensitive_words WHERE word = ?", [word]);
      const res = await admin.delete(`/api/v1/admin/review-governance/sensitive-words/${rows[0].id}`);
      expect(res.status).toBe(200);
      const [post] = await pool.query("SELECT is_active FROM sensitive_words WHERE id = ?", [rows[0].id]);
      expect(Number(post[0].is_active)).toBe(0);
      await pool.query("DELETE FROM sensitive_words WHERE id = ?", [rows[0].id]);
    });
  });

  describe("GET /denylist-hashes", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/admin/review-governance/denylist-hashes");
      expect(res.status).toBe(401);
    });
    test("403 regular user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/admin/review-governance/denylist-hashes");
      expect(res.status).toBe(403);
    });
    test("200 admin lists hashes", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/review-governance/denylist-hashes");
      expect(res.status).toBe(200);
    });
  });

  describe("POST /denylist-hashes", () => {
    test("400 hash wrong length", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.post("/api/v1/admin/review-governance/denylist-hashes").send({ sha256Hash: "abc", reason: "test reason" });
      expect(res.status).toBe(400);
    });
    test("201 adds hash to DB", async () => {
      const admin = await loginAsAdmin();
      const sha = "a".repeat(64);
      const res = await admin.post("/api/v1/admin/review-governance/denylist-hashes").send({ sha256Hash: sha, reason: "testing reason" });
      expect(res.status).toBe(201);
      const [rows] = await pool.query("SELECT * FROM image_hash_denylist WHERE sha256_hash = ?", [sha]);
      expect(rows.length).toBe(1);
      await pool.query("DELETE FROM image_hash_denylist WHERE sha256_hash = ?", [sha]);
    });
  });

  describe("DELETE /denylist-hashes/:id", () => {
    test("200 removes row", async () => {
      const admin = await loginAsAdmin();
      const sha = "b".repeat(64);
      await admin.post("/api/v1/admin/review-governance/denylist-hashes").send({ sha256Hash: sha, reason: "temp" });
      const [rows] = await pool.query("SELECT id FROM image_hash_denylist WHERE sha256_hash = ?", [sha]);
      const res = await admin.delete(`/api/v1/admin/review-governance/denylist-hashes/${rows[0].id}`);
      expect(res.status).toBe(200);
      const [post] = await pool.query("SELECT id FROM image_hash_denylist WHERE id = ?", [rows[0].id]);
      expect(post.length).toBe(0);
    });
  });

  describe("GET /blacklist", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/admin/review-governance/blacklist");
      expect(res.status).toBe(401);
    });
    test("403 regular user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/admin/review-governance/blacklist");
      expect(res.status).toBe(403);
    });
    test("200 admin lists blacklist", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/review-governance/blacklist");
      expect(res.status).toBe(200);
    });
  });

  describe("POST /blacklist", () => {
    test("400 missing fields", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.post("/api/v1/admin/review-governance/blacklist").send({ reason: "x" });
      expect(res.status).toBe(400);
    });
    test("201 admin blacklists user", async () => {
      const admin = await loginAsAdmin();
      const athleteId = await getUserId("athlete1");
      const res = await admin.post("/api/v1/admin/review-governance/blacklist").send({
        userId: athleteId, reason: "repeated violations for testing", days: 7
      });
      expect(res.status).toBe(201);
      const [rows] = await pool.query("SELECT id FROM review_blacklist WHERE user_id = ? AND is_active = 1", [athleteId]);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      await pool.query("DELETE FROM review_blacklist WHERE user_id = ?", [athleteId]);
    });
  });

  describe("DELETE /blacklist/:id", () => {
    test("200 deactivates blacklist entry", async () => {
      const admin = await loginAsAdmin();
      const athleteId = await getUserId("athlete1");
      await admin.post("/api/v1/admin/review-governance/blacklist").send({
        userId: athleteId, reason: "test for removal", days: 5
      });
      const [rows] = await pool.query("SELECT id FROM review_blacklist WHERE user_id = ? ORDER BY id DESC LIMIT 1", [athleteId]);
      const res = await admin.delete(`/api/v1/admin/review-governance/blacklist/${rows[0].id}`);
      expect(res.status).toBe(200);
      const [post] = await pool.query("SELECT is_active FROM review_blacklist WHERE id = ?", [rows[0].id]);
      expect(Number(post[0].is_active)).toBe(0);
      await pool.query("DELETE FROM review_blacklist WHERE id = ?", [rows[0].id]);
    });
  });
});
