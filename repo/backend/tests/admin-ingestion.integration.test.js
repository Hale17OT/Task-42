const fs = require("fs");
const path = require("path");
const { describeDb, pool, unauth, unique, loginAsAthlete, loginAsCoach, loginAsSupport, loginAsAdmin } = require("./helpers/integration-helpers");

describeDb("Admin ingestion endpoints", () => {
  describe("GET /sources", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/admin/ingestion/sources");
      expect(res.status).toBe(401);
    });
    test("403 regular user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/admin/ingestion/sources");
      expect(res.status).toBe(403);
    });
    test("403 support (admin only)", async () => {
      const supp = await loginAsSupport();
      const res = await supp.get("/api/v1/admin/ingestion/sources");
      expect(res.status).toBe(403);
    });
    test("200 admin lists sources", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/ingestion/sources");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe("POST /sources", () => {
    test("400 missing fields", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.post("/api/v1/admin/ingestion/sources").send({ sourceName: "x" });
      expect(res.status).toBe(400);
    });
    test("201 creates source and persists to DB", async () => {
      const admin = await loginAsAdmin();
      const name = unique("src");
      const res = await admin.post("/api/v1/admin/ingestion/sources").send({
        sourceName: name,
        sourceType: "api_payload",
        ingestPath: "/tmp/test-ingestion",
        allowlisted: true,
        blocklisted: false,
        rateLimitPerMinute: 60,
        sourceStatus: "active"
      });
      expect(res.status).toBe(201);
      const [rows] = await pool.query("SELECT * FROM content_sources WHERE source_name = ?", [name]);
      expect(rows.length).toBe(1);
      expect(Number(rows[0].allowlisted)).toBe(1);
      await pool.query("DELETE FROM content_sources WHERE source_name = ?", [name]);
    });
  });

  describe("PATCH /sources/:id", () => {
    test("400 non-numeric id", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.patch("/api/v1/admin/ingestion/sources/abc").send({ sourceStatus: "paused" });
      expect(res.status).toBe(400);
    });
    test("200 admin updates source", async () => {
      const admin = await loginAsAdmin();
      const name = unique("src");
      const create = await admin.post("/api/v1/admin/ingestion/sources").send({
        sourceName: name, sourceType: "api_payload", ingestPath: "/tmp/a", allowlisted: true
      });
      const res = await admin.patch(`/api/v1/admin/ingestion/sources/${create.body.data.id}`).send({ sourceStatus: "paused" });
      expect(res.status).toBe(200);
      expect(res.body.data.source_status).toBe("paused");
      await pool.query("DELETE FROM content_sources WHERE id = ?", [create.body.data.id]);
    });
    test("400 empty patch", async () => {
      const admin = await loginAsAdmin();
      const name = unique("src");
      const create = await admin.post("/api/v1/admin/ingestion/sources").send({
        sourceName: name, sourceType: "api_payload", ingestPath: "/tmp/b", allowlisted: true
      });
      const res = await admin.patch(`/api/v1/admin/ingestion/sources/${create.body.data.id}`).send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("NO_UPDATES");
      await pool.query("DELETE FROM content_sources WHERE id = ?", [create.body.data.id]);
    });
  });

  describe("POST /scan", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().post("/api/v1/admin/ingestion/scan");
      expect(res.status).toBe(401);
    });
    test("403 regular user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/admin/ingestion/scan");
      expect(res.status).toBe(403);
    });
    test("200 admin queues scan job", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.post("/api/v1/admin/ingestion/scan");
      expect(res.status).toBe(200);
      expect(res.body.data.queued).toBe(true);

      const [jobs] = await pool.query("SELECT id FROM queue_jobs WHERE job_type = 'ingestion_scan_sources' ORDER BY id DESC LIMIT 1");
      expect(jobs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("GET /logs", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/admin/ingestion/logs");
      expect(res.status).toBe(401);
    });
    test("403 regular user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/admin/ingestion/logs");
      expect(res.status).toBe(403);
    });
    test("200 admin lists logs", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/ingestion/logs?limit=10");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
    test("400 invalid limit", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/admin/ingestion/logs?limit=notanumber");
      expect(res.status).toBe(400);
    });
  });

  describe("Ingestion sensitive word screening (end-to-end)", () => {
    test("ingested content with sensitive word is quarantined", async () => {
      const admin = await loginAsAdmin();
      const word = unique("forbw").slice(0, 40);
      await admin.post("/api/v1/admin/review-governance/sensitive-words").send({ word });

      // Create source pointing to a tmp directory we control
      const ingestDir = path.join(require("os").tmpdir(), unique("ingest"));
      fs.mkdirSync(ingestDir, { recursive: true });
      const name = unique("src");
      const create = await admin.post("/api/v1/admin/ingestion/sources").send({
        sourceName: name,
        sourceType: "api_payload",
        ingestPath: ingestDir,
        allowlisted: true
      });
      const sourceId = create.body.data.id;

      // Drop a file containing the sensitive word
      const payload = JSON.stringify({
        items: [
          { id: unique("it"), title: "Safe Title", author: "A", summary: "clean content", tags: [] },
          { id: unique("it"), title: "Bad", author: "B", summary: `contains ${word} here`, tags: [] }
        ]
      });
      const filePath = path.join(ingestDir, `${unique("file")}.json`);
      fs.writeFileSync(filePath, payload);

      // Invoke the processor directly
      const { handleIngestionProcessFileJob } = require("../src/modules/ingestion/ingestion.service");
      await handleIngestionProcessFileJob({ sourceId, filePath });

      const [items] = await pool.query(
        "SELECT ingestion_status FROM ingested_content_items WHERE source_id = ? ORDER BY id DESC LIMIT 2",
        [sourceId]
      );
      const statuses = items.map((i) => i.ingestion_status).sort();
      expect(statuses).toEqual(["published", "quarantined"]);

      const [logs] = await pool.query(
        "SELECT log_type FROM immutable_ingestion_logs WHERE source_id = ? AND log_type = 'moderation_flag'",
        [sourceId]
      );
      expect(logs.length).toBeGreaterThanOrEqual(1);

      // cleanup
      await pool.query("DELETE FROM immutable_ingestion_logs WHERE source_id = ?", [sourceId]);
      await pool.query("DELETE FROM ingested_content_items WHERE source_id = ?", [sourceId]);
      await pool.query("DELETE FROM content_sources WHERE id = ?", [sourceId]);
      await pool.query("DELETE FROM sensitive_words WHERE word = ?", [word]);
      fs.rmSync(ingestDir, { recursive: true, force: true });
    }, 20000);
  });
});
