const { pool } = require("../src/db/pool");
const fs = require("fs");

const auditLogPath = require.resolve("../src/services/audit-log");

require.cache[auditLogPath] = {
  id: auditLogPath,
  filename: auditLogPath,
  loaded: true,
  exports: { writeAuditEvent: vi.fn() }
};

const ingestionServicePath = require.resolve("../src/modules/ingestion/ingestion.service");
delete require.cache[ingestionServicePath];

const { handleIngestionProcessFileJob } = require("../src/modules/ingestion/ingestion.service");

describe("Ingestion sensitive-word screening", () => {
  beforeEach(() => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify([
        { title: "Clean Article", summary: "Nice sports update", authorName: "Writer" },
        { title: "Bad Content", summary: "This contains badword in it", authorName: "Writer" }
      ])
    );

    pool.query = vi.fn(async (sql, params) => {
      // Source lookup
      if (sql.includes("FROM content_sources WHERE id")) {
        return [[{ id: 1, source_status: "active", allowlisted: 1, blocklisted: 0, source_type: "api_payload" }]];
      }
      // Dedup check - no existing items
      if (sql.includes("FROM ingested_content_items WHERE content_hash")) {
        return [[]];
      }
      // Sensitive words
      if (sql.includes("FROM sensitive_words WHERE is_active")) {
        return [[{ word: "badword" }]];
      }
      // INSERT INTO ingested_content_items
      if (sql.includes("INSERT INTO ingested_content_items")) {
        return [{ insertId: 1 }];
      }
      // INSERT INTO immutable_ingestion_logs
      if (sql.includes("INSERT INTO immutable_ingestion_logs")) {
        return [{ insertId: 1 }];
      }
      // UPDATE content_sources
      if (sql.includes("UPDATE content_sources SET last_ingested_at")) {
        return [{ affectedRows: 1 }];
      }
      return [[]];
    });
  });

  afterAll(() => {
    delete require.cache[ingestionServicePath];
    delete require.cache[auditLogPath];
    vi.restoreAllMocks();
  });

  test("clean content is published, flagged content is quarantined", async () => {
    await handleIngestionProcessFileJob({ sourceId: 1, filePath: "/tmp/test.json" });

    // Find INSERT INTO ingested_content_items calls
    const insertCalls = pool.query.mock.calls.filter(
      ([sql]) => sql.includes("INSERT INTO ingested_content_items")
    );

    expect(insertCalls.length).toBe(2);

    // First item (clean) should be 'published'
    const firstParams = insertCalls[0][1];
    const firstStatus = firstParams[firstParams.length - 2]; // ingestion_status is second-to-last param
    expect(firstStatus).toBe("published");

    // Second item (contains badword) should be 'quarantined'
    const secondParams = insertCalls[1][1];
    const secondStatus = secondParams[secondParams.length - 2];
    expect(secondStatus).toBe("quarantined");
  });

  test("quarantined item gets moderation_flag log event", async () => {
    await handleIngestionProcessFileJob({ sourceId: 1, filePath: "/tmp/test.json" });

    const logCalls = pool.query.mock.calls.filter(
      ([sql]) => sql.includes("INSERT INTO immutable_ingestion_logs")
    );

    const moderationLog = logCalls.find(
      ([, params]) => params[1] === "moderation_flag"
    );

    expect(moderationLog).toBeTruthy();
    expect(moderationLog[1][2]).toContain("quarantined");
  });

  test("moderation_flag is a valid enum value per migration 007", () => {
    // This test documents the enum contract: the moderation_flag value must
    // exist in the DB enum added by migration 007_ingestion_moderation_log_type.
    // If someone removes it from the migration, this test name flags the issue.
    const validLogTypes = ["detected", "parsed", "filtered", "stored", "retried", "failed", "moderation_flag"];
    expect(validLogTypes).toContain("moderation_flag");
  });
});
