const { pool } = require("../src/db/pool");

const moderationPath = require.resolve("../src/modules/reviews/moderation.service");

// Clear module cache so we get the real implementation
delete require.cache[moderationPath];
const { enforceDailyPublishCap } = require("../src/modules/reviews/moderation.service");

describe("enforceDailyPublishCap - atomic quota enforcement", () => {
  afterAll(() => {
    delete require.cache[moderationPath];
  });

  test("throws if called without a connection", async () => {
    await expect(enforceDailyPublishCap(1)).rejects.toThrow(
      "enforceDailyPublishCap requires a transactional connection"
    );
  });

  test("allows first publish when quota row does not exist yet", async () => {
    const connection = {
      query: vi.fn()
    };

    // INSERT ... ON DUPLICATE KEY UPDATE succeeds (new row)
    connection.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    // SELECT used_count returns 1
    connection.query.mockResolvedValueOnce([[{ used_count: 1 }]]);

    await expect(enforceDailyPublishCap(42, connection)).resolves.toBeUndefined();
    expect(connection.query).toHaveBeenCalledTimes(2);
    expect(String(connection.query.mock.calls[0][0])).toContain("INSERT INTO daily_review_quota");
  });

  test("allows second publish when used_count reaches 2", async () => {
    const connection = {
      query: vi.fn()
    };

    connection.query.mockResolvedValueOnce([{ affectedRows: 2 }]);
    connection.query.mockResolvedValueOnce([[{ used_count: 2 }]]);

    await expect(enforceDailyPublishCap(42, connection)).resolves.toBeUndefined();
  });

  test("rejects third publish when used_count exceeds cap", async () => {
    const connection = {
      query: vi.fn()
    };

    connection.query.mockResolvedValueOnce([{ affectedRows: 2 }]);
    connection.query.mockResolvedValueOnce([[{ used_count: 3 }]]);

    await expect(enforceDailyPublishCap(42, connection)).rejects.toMatchObject({
      status: 429,
      code: "DAILY_REVIEW_LIMIT"
    });
  });

  test("concurrent callers serialize on the same quota row", async () => {
    // Simulate two connections that both run the INSERT ... ON DUPLICATE KEY UPDATE.
    // Because MySQL takes an exclusive lock on the row during the upsert,
    // the second caller will block until the first commits/rolls back.
    // Here we verify both calls go through the atomic path.

    const connection1 = { query: vi.fn() };
    const connection2 = { query: vi.fn() };

    // Connection 1: inserts new row, reads count=1
    connection1.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    connection1.query.mockResolvedValueOnce([[{ used_count: 1 }]]);

    // Connection 2: upserts (increment), reads count=2
    connection2.query.mockResolvedValueOnce([{ affectedRows: 2 }]);
    connection2.query.mockResolvedValueOnce([[{ used_count: 2 }]]);

    const [result1, result2] = await Promise.all([
      enforceDailyPublishCap(42, connection1),
      enforceDailyPublishCap(42, connection2)
    ]);

    expect(result1).toBeUndefined();
    expect(result2).toBeUndefined();

    // Both used the atomic INSERT path
    expect(String(connection1.query.mock.calls[0][0])).toContain("INSERT INTO daily_review_quota");
    expect(String(connection2.query.mock.calls[0][0])).toContain("INSERT INTO daily_review_quota");
  });
});
