const fs = require("fs");
const { pool } = require("../src/db/pool");
const { handleIngestionProcessFileJob } = require("../src/modules/ingestion/ingestion.service");

describe("Ingestion process job", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pool.query = vi.fn();
  });

  test("skips duplicate items idempotently", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ items: [{ id: "item-1", title: "Trail update", author: "Alice", summary: "x", tags: ["run"] }] })
    );

    const contentInsertSpy = vi.fn();

    pool.query.mockImplementation(async (sql) => {
      if (sql.includes("SELECT * FROM content_sources")) {
        return [[{ id: 1, source_status: "active", allowlisted: 1, blocklisted: 0, source_type: "api_payload" }]];
      }
      if (sql.includes("INSERT INTO immutable_ingestion_logs")) {
        return [{}];
      }
      if (sql.includes("SELECT id FROM ingested_content_items")) {
        return [[{ id: 100 }]];
      }
      if (sql.includes("INSERT INTO ingested_content_items")) {
        contentInsertSpy();
        return [{}];
      }
      if (sql.includes("UPDATE content_sources SET last_ingested_at")) {
        return [{}];
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    await handleIngestionProcessFileJob({ sourceId: 1, filePath: "/tmp/content.json" });
    expect(contentInsertSpy).not.toHaveBeenCalled();
  });

  test("stores normalized content when item is new", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ items: [{ id: "item-2", title: "New release", author: "Bob", summary: "Details", tags: ["bike"] }] })
    );

    const contentInsertSpy = vi.fn();
    let sourceUpdated = false;

    pool.query.mockImplementation(async (sql) => {
      if (sql.includes("SELECT * FROM content_sources")) {
        return [[{ id: 1, source_status: "active", allowlisted: 1, blocklisted: 0, source_type: "api_payload" }]];
      }
      if (sql.includes("INSERT INTO immutable_ingestion_logs")) {
        return [{}];
      }
      if (sql.includes("SELECT id FROM ingested_content_items")) {
        return [[]];
      }
      if (sql.includes("SELECT word FROM sensitive_words")) {
        return [[]];
      }
      if (sql.includes("INSERT INTO ingested_content_items")) {
        contentInsertSpy();
        return [{}];
      }
      if (sql.includes("UPDATE content_sources SET last_ingested_at")) {
        sourceUpdated = true;
        return [{}];
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    await handleIngestionProcessFileJob({ sourceId: 1, filePath: "/tmp/content.json" });
    expect(contentInsertSpy).toHaveBeenCalledTimes(1);
    expect(sourceUpdated).toBe(true);
  });
});
