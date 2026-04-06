const crypto = require("crypto");
const request = require("supertest");
const app = require("../src/app");
const { pool } = require("../src/db/pool");

const runDbTests = process.env.RUN_DB_TESTS === "1";
const describeDb = runDbTests ? describe : describe.skip;

function unique(label) {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

// Matches reconciliation-parser.js: buildSignaturePayload and verifyRecordSignature
function signRecord({ orderId, providerTxnId, amountCents, status, occurredAt }, secret) {
  const payload = `${orderId}|${providerTxnId}|${amountCents}|${status}|${occurredAt}`;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function buildCsvRow({ orderId, providerTxnId, amountCents, status, occurredAt }, secret) {
  const sig = signRecord({ orderId, providerTxnId, amountCents, status, occurredAt }, secret);
  return `${orderId},${providerTxnId},${amountCents},${status},${occurredAt},${sig}`;
}

const CSV_HEADER = "order_id,provider_txn_id,amount_cents,status,occurred_at,signature";

describeDb("Payment import + worker integration", () => {
  const RECON_SECRET = process.env.WECHAT_RECON_SECRET || "trailforge-recon-secret";

  test("valid import creates queued jobs that process payments", async () => {
    const connection = await pool.getConnection();
    const cleanup = { courseId: null, orderId: null, importId: null };

    try {
      const [users] = await connection.query(
        "SELECT id, username FROM users WHERE username IN ('support1', 'athlete1')"
      );
      const support = users.find((u) => u.username === "support1");
      const athlete = users.find((u) => u.username === "athlete1");

      const [courseInsert] = await connection.query(
        `INSERT INTO courses_services (kind, title, description, provider_user_id, status)
         VALUES ('service', ?, 'payment integration fixture', ?, 'active')`,
        [unique("Pay Test"), support.id]
      );
      cleanup.courseId = courseInsert.insertId;

      const [orderInsert] = await connection.query(
        `INSERT INTO orders (user_id, course_service_id, order_type, order_status,
         total_amount_cents, paid_amount_cents, refunded_amount_cents, currency, idempotency_key)
         VALUES (?, ?, 'service', 'pending_payment', 500, 0, 0, 'USD', ?)`,
        [athlete.id, cleanup.courseId, unique("pay-order")]
      );
      cleanup.orderId = orderInsert.insertId;

      const txnId = unique("txn");
      const occurredAt = new Date().toISOString();
      const csvContent = [
        CSV_HEADER,
        buildCsvRow({
          orderId: cleanup.orderId,
          providerTxnId: txnId,
          amountCents: 500,
          status: "SUCCESS",
          occurredAt
        }, RECON_SECRET)
      ].join("\n");

      const agent = request.agent(app.callback());
      await agent.post("/api/v1/auth/login").send({ username: "support1", password: "support12345" });

      const importRes = await agent
        .post("/api/v1/payments/imports")
        .send({ fileName: "test.csv", content: csvContent });

      expect(importRes.status).toBe(201);
      expect(importRes.body.data.signatureVerified).toBe(true);
      expect(importRes.body.data.records).toBe(1);
      cleanup.importId = importRes.body.data.importId;

      const [jobs] = await connection.query(
        "SELECT id, job_type, status FROM queue_jobs WHERE idempotency_key LIKE ?",
        [`payment_apply:${cleanup.importId}:%`]
      );
      expect(jobs.length).toBe(1);
      expect(jobs[0].job_type).toBe("apply_payment_record");
      expect(jobs[0].status).toBe("pending");
    } finally {
      if (cleanup.importId) {
        await connection.query("DELETE FROM queue_jobs WHERE idempotency_key LIKE ?", [`payment_apply:${cleanup.importId}:%`]);
        await connection.query("DELETE FROM payment_reconciliation_imports WHERE id = ?", [cleanup.importId]);
      }
      if (cleanup.orderId) {
        await connection.query("DELETE FROM payments WHERE order_id = ?", [cleanup.orderId]);
        await connection.query("DELETE FROM orders WHERE id = ?", [cleanup.orderId]);
      }
      if (cleanup.courseId) {
        await connection.query("DELETE FROM courses_services WHERE id = ?", [cleanup.courseId]);
      }
      connection.release();
    }
  }, 20000);

  test("duplicate import returns existing without creating new jobs", async () => {
    const connection = await pool.getConnection();
    const cleanup = { courseId: null, orderId: null, importId: null };

    try {
      const [users] = await connection.query(
        "SELECT id, username FROM users WHERE username IN ('support1', 'athlete1')"
      );
      const support = users.find((u) => u.username === "support1");
      const athlete = users.find((u) => u.username === "athlete1");

      const [courseInsert] = await connection.query(
        `INSERT INTO courses_services (kind, title, description, provider_user_id, status)
         VALUES ('service', ?, 'dup import fixture', ?, 'active')`,
        [unique("Dup Test"), support.id]
      );
      cleanup.courseId = courseInsert.insertId;

      const [orderInsert] = await connection.query(
        `INSERT INTO orders (user_id, course_service_id, order_type, order_status,
         total_amount_cents, paid_amount_cents, refunded_amount_cents, currency, idempotency_key)
         VALUES (?, ?, 'service', 'pending_payment', 100, 0, 0, 'USD', ?)`,
        [athlete.id, cleanup.courseId, unique("dup-order")]
      );
      cleanup.orderId = orderInsert.insertId;

      const agent = request.agent(app.callback());
      await agent.post("/api/v1/auth/login").send({ username: "support1", password: "support12345" });

      const txnId = unique("dup-txn");
      const occurredAt = new Date().toISOString();
      const csvContent = [
        CSV_HEADER,
        buildCsvRow({
          orderId: cleanup.orderId,
          providerTxnId: txnId,
          amountCents: 100,
          status: "SUCCESS",
          occurredAt
        }, RECON_SECRET)
      ].join("\n");

      const res1 = await agent
        .post("/api/v1/payments/imports")
        .send({ fileName: "dup.csv", content: csvContent });
      expect(res1.status).toBe(201);
      expect(res1.body.data.duplicate).toBe(false);
      cleanup.importId = res1.body.data.importId;

      const res2 = await agent
        .post("/api/v1/payments/imports")
        .send({ fileName: "dup2.csv", content: csvContent });
      expect(res2.status).toBe(200);
      expect(res2.body.data.duplicate).toBe(true);
    } finally {
      if (cleanup.importId) {
        await connection.query("DELETE FROM queue_jobs WHERE idempotency_key LIKE ?", [`payment_apply:${cleanup.importId}:%`]);
        await connection.query("DELETE FROM payment_reconciliation_imports WHERE id = ?", [cleanup.importId]);
      }
      if (cleanup.orderId) {
        await connection.query("DELETE FROM orders WHERE id = ?", [cleanup.orderId]);
      }
      if (cleanup.courseId) {
        await connection.query("DELETE FROM courses_services WHERE id = ?", [cleanup.courseId]);
      }
      connection.release();
    }
  }, 20000);

  test("invalid signature import is flagged", async () => {
    const connection = await pool.getConnection();
    const cleanup = { courseId: null, orderId: null, importId: null };

    try {
      const [users] = await connection.query(
        "SELECT id, username FROM users WHERE username IN ('support1', 'athlete1')"
      );
      const support = users.find((u) => u.username === "support1");
      const athlete = users.find((u) => u.username === "athlete1");

      const [courseInsert] = await connection.query(
        `INSERT INTO courses_services (kind, title, description, provider_user_id, status)
         VALUES ('service', ?, 'sig test fixture', ?, 'active')`,
        [unique("Sig Test"), support.id]
      );
      cleanup.courseId = courseInsert.insertId;

      const [orderInsert] = await connection.query(
        `INSERT INTO orders (user_id, course_service_id, order_type, order_status,
         total_amount_cents, paid_amount_cents, refunded_amount_cents, currency, idempotency_key)
         VALUES (?, ?, 'service', 'pending_payment', 100, 0, 0, 'USD', ?)`,
        [athlete.id, cleanup.courseId, unique("sig-order")]
      );
      cleanup.orderId = orderInsert.insertId;

      const agent = request.agent(app.callback());
      await agent.post("/api/v1/auth/login").send({ username: "support1", password: "support12345" });

      const occurredAt = new Date().toISOString();
      const csvContent = [
        CSV_HEADER,
        `${cleanup.orderId},${unique("bad-txn")},100,SUCCESS,${occurredAt},invalidsignature`
      ].join("\n");

      const res = await agent
        .post("/api/v1/payments/imports")
        .send({ fileName: "bad-sig.csv", content: csvContent });

      expect(res.status).toBe(201);
      expect(res.body.data.signatureVerified).toBe(false);
      cleanup.importId = res.body.data.importId;
    } finally {
      if (cleanup.importId) {
        await connection.query("DELETE FROM queue_jobs WHERE idempotency_key LIKE ?", [`payment_apply:${cleanup.importId}:%`]);
        await connection.query("DELETE FROM payment_reconciliation_imports WHERE id = ?", [cleanup.importId]);
      }
      if (cleanup.orderId) {
        await connection.query("DELETE FROM orders WHERE id = ?", [cleanup.orderId]);
      }
      if (cleanup.courseId) {
        await connection.query("DELETE FROM courses_services WHERE id = ?", [cleanup.courseId]);
      }
      connection.release();
    }
  }, 20000);
});
