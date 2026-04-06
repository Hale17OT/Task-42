const { pool } = require("../src/db/pool");
const logger = require("../src/logger");

const { markJobFailed, markJobCompleted, claimRunnableJobs } = require("../src/modules/queue/queue.service");

describe("Queue service retry and dead-letter semantics", () => {
  beforeEach(() => {
    pool.query = vi.fn(async () => [{ affectedRows: 1 }]);
    pool.getConnection = vi.fn();
    vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logger.error.mockRestore?.();
  });

  test("markJobFailed retries when attempts < maxAttempts", async () => {
    const job = { id: 1, attempts: 0, maxAttempts: 3 };

    await markJobFailed(job, "transient error");

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("SET status = 'failed'");
    expect(sql).toContain("next_run_at = DATE_ADD");
    expect(params[0]).toBe(1); // nextAttempts = 0 + 1
    expect(params[1]).toBe("transient error");
  });

  test("markJobFailed uses exponential backoff", async () => {
    const job = { id: 2, attempts: 2, maxAttempts: 5 };

    await markJobFailed(job, "retry error");

    const [sql, params] = pool.query.mock.calls[0];
    // attempts=2 → nextAttempts=3 → backoff = min(300, 2^3) = 8 seconds
    expect(params[2]).toBe(8);
  });

  test("markJobFailed caps backoff at 300 seconds", async () => {
    const job = { id: 3, attempts: 9, maxAttempts: 15 };

    await markJobFailed(job, "retry error");

    const [sql, params] = pool.query.mock.calls[0];
    // attempts=9 → nextAttempts=10 → 2^10=1024 → capped at 300
    expect(params[2]).toBe(300);
  });

  test("markJobFailed moves to dead_letter when attempts exhausted", async () => {
    const job = { id: 4, attempts: 2, maxAttempts: 3 };

    await markJobFailed(job, "permanent failure");

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("SET status = 'dead_letter'");
    expect(params[0]).toBe(3); // nextAttempts = 2 + 1
    expect(params[1]).toBe("permanent failure");
  });

  test("dead_letter logs error with job details", async () => {
    const job = { id: 5, attempts: 4, maxAttempts: 5 };

    await markJobFailed(job, "final failure");

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toMatchObject({
      jobId: 5,
      errorMessage: "final failure"
    });
  });

  test("markJobCompleted sets status to completed", async () => {
    await markJobCompleted(42);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("SET status = 'completed'");
    expect(params).toEqual([42]);
  });

  test("claimRunnableJobs uses FOR UPDATE SKIP LOCKED", async () => {
    const connection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      query: vi.fn()
    };
    pool.getConnection.mockResolvedValue(connection);

    // SELECT returns one job
    connection.query.mockResolvedValueOnce([[{
      id: 1,
      job_type: "test_job",
      payload: '{"key":"value"}',
      attempts: 0,
      max_attempts: 3
    }]]);
    // UPDATE to running
    connection.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const jobs = await claimRunnableJobs(5);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: 1,
      jobType: "test_job",
      payload: { key: "value" }
    });

    const selectSql = connection.query.mock.calls[0][0];
    expect(selectSql).toContain("FOR UPDATE SKIP LOCKED");

    const updateSql = connection.query.mock.calls[1][0];
    expect(updateSql).toContain("SET status = 'running'");
  });
});
