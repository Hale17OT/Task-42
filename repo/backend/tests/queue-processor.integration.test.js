const { describeDb, pool, unique, loginAsAthlete, loginAsSupport, getUserId } = require("./helpers/integration-helpers");
const { enqueueJob, claimRunnableJobs, markJobCompleted, markJobFailed } = require("../src/modules/queue/queue.service");
const { processQueueTick } = require("../src/modules/payments/processor.service");

describeDb("Queue service + processor (real DB)", () => {
  test("enqueueJob inserts and claimRunnableJobs returns pending rows", async () => {
    const key = `test-queue:${unique("k")}`;
    await enqueueJob({
      jobType: "payment_compensation_review",
      payload: { note: "test" },
      idempotencyKey: key,
      maxAttempts: 3
    });

    const [rows] = await pool.query("SELECT id, status FROM queue_jobs WHERE idempotency_key = ?", [key]);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("pending");

    // claim
    const claimed = await claimRunnableJobs(10);
    const found = claimed.find((j) => j.id === rows[0].id);
    expect(found).toBeDefined();
    expect(found.jobType).toBe("payment_compensation_review");
    expect(found.payload).toEqual({ note: "test" });

    // now it should be marked running
    const [after] = await pool.query("SELECT status FROM queue_jobs WHERE id = ?", [rows[0].id]);
    expect(after[0].status).toBe("running");

    await markJobCompleted(rows[0].id);
    await pool.query("DELETE FROM queue_jobs WHERE id = ?", [rows[0].id]);
  });

  test("markJobFailed increments attempts and schedules retry with backoff", async () => {
    const key = `test-retry:${unique("k")}`;
    await enqueueJob({
      jobType: "payment_compensation_review",
      payload: {},
      idempotencyKey: key,
      maxAttempts: 3
    });
    const [rows] = await pool.query("SELECT id FROM queue_jobs WHERE idempotency_key = ?", [key]);
    const jobId = rows[0].id;

    const job = { id: jobId, attempts: 0, maxAttempts: 3 };
    await markJobFailed(job, "first failure");

    const [post] = await pool.query("SELECT status, attempts, last_error, next_run_at, UNIX_TIMESTAMP(next_run_at) - UNIX_TIMESTAMP(NOW()) AS delay_seconds FROM queue_jobs WHERE id = ?", [jobId]);
    expect(post[0].status).toBe("failed");
    expect(post[0].attempts).toBe(1);
    expect(post[0].last_error).toBe("first failure");
    // backoff = min(300, 2^1) = 2 seconds
    expect(Number(post[0].delay_seconds)).toBeGreaterThanOrEqual(1);

    await pool.query("DELETE FROM queue_jobs WHERE id = ?", [jobId]);
  });

  test("markJobFailed transitions to dead_letter when attempts exhausted", async () => {
    const key = `test-dead:${unique("k")}`;
    await enqueueJob({
      jobType: "payment_compensation_review",
      payload: {},
      idempotencyKey: key,
      maxAttempts: 3
    });
    const [rows] = await pool.query("SELECT id FROM queue_jobs WHERE idempotency_key = ?", [key]);
    const jobId = rows[0].id;

    const job = { id: jobId, attempts: 2, maxAttempts: 3 };
    await markJobFailed(job, "permanent");

    const [post] = await pool.query("SELECT status, attempts, last_error FROM queue_jobs WHERE id = ?", [jobId]);
    expect(post[0].status).toBe("dead_letter");
    expect(post[0].attempts).toBe(3);
    expect(post[0].last_error).toBe("permanent");

    await pool.query("DELETE FROM queue_jobs WHERE id = ?", [jobId]);
  });

  test("processQueueTick handles payment_compensation_review as ack-only", async () => {
    const key = `test-tick:${unique("k")}`;
    await enqueueJob({
      jobType: "payment_compensation_review",
      payload: {},
      idempotencyKey: key,
      maxAttempts: 3
    });

    await processQueueTick(20);

    const [post] = await pool.query("SELECT status FROM queue_jobs WHERE idempotency_key = ?", [key]);
    expect(post[0].status).toBe("completed");

    await pool.query("DELETE FROM queue_jobs WHERE idempotency_key = ?", [key]);
  });

  test("cancel_unpaid_order job cancels pending order when past deadline", async () => {
    const athleteId = await getUserId("athlete1");
    const [courseRows] = await pool.query("SELECT id FROM courses_services WHERE status = 'active' LIMIT 1");
    const [ins] = await pool.query(
      `INSERT INTO orders (user_id, course_service_id, order_type, order_status, total_amount_cents, payment_due_at, idempotency_key)
       VALUES (?, ?, 'course', 'pending_payment', 500, DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR), ?)`,
      [athleteId, courseRows[0].id, unique("qpo")]
    );
    const orderId = ins.insertId;

    const key = `cancel_unpaid_order:${orderId}`;
    await enqueueJob({
      jobType: "cancel_unpaid_order",
      payload: { orderId },
      idempotencyKey: key,
      maxAttempts: 2
    });

    await processQueueTick(20);

    const [orderRows] = await pool.query("SELECT order_status FROM orders WHERE id = ?", [orderId]);
    expect(orderRows[0].order_status).toBe("cancelled");

    await pool.query("DELETE FROM queue_jobs WHERE idempotency_key = ?", [key]);
    await pool.query("DELETE FROM orders WHERE id = ?", [orderId]);
  });

  test("enqueueJob with same idempotency_key is a no-op (upsert)", async () => {
    const key = `test-idemp:${unique("k")}`;
    await enqueueJob({
      jobType: "payment_compensation_review",
      payload: { x: 1 },
      idempotencyKey: key
    });
    await enqueueJob({
      jobType: "payment_compensation_review",
      payload: { x: 2 },
      idempotencyKey: key
    });

    const [rows] = await pool.query("SELECT id FROM queue_jobs WHERE idempotency_key = ?", [key]);
    expect(rows.length).toBe(1);

    await pool.query("DELETE FROM queue_jobs WHERE idempotency_key = ?", [key]);
  });
});
