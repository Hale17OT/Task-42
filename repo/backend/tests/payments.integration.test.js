const crypto = require("crypto");
const { describeDb, pool, unauth, unique, loginAsAthlete, loginAsCoach, loginAsSupport, loginAsAdmin, getUserId } = require("./helpers/integration-helpers");

const RECON_SECRET = process.env.WECHAT_RECON_SECRET || "trailforge-recon-secret";
const CSV_HEADER = "order_id,provider_txn_id,amount_cents,status,occurred_at,signature";

function sign(row, secret) {
  const payload = `${row.orderId}|${row.providerTxnId}|${row.amountCents}|${row.status}|${row.occurredAt}`;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function buildRow({ orderId, providerTxnId, amountCents, status, occurredAt }) {
  const signature = sign({ orderId, providerTxnId, amountCents, status, occurredAt }, RECON_SECRET);
  return `${orderId},${providerTxnId},${amountCents},${status},${occurredAt},${signature}`;
}

async function createPaidOrder(userId) {
  const [courseRows] = await pool.query("SELECT id FROM courses_services WHERE status = 'active' LIMIT 1");
  const [ins] = await pool.query(
    `INSERT INTO orders (user_id, course_service_id, order_type, order_status, total_amount_cents, paid_amount_cents, refunded_amount_cents, currency, idempotency_key)
     VALUES (?, ?, 'course', 'paid', 1000, 1000, 0, 'USD', ?)`,
    [userId, courseRows[0].id, unique("po")]
  );
  const [pay] = await pool.query(
    `INSERT INTO payments (order_id, provider, provider_txn_id, payment_status, amount_cents, signature_valid, raw_payload, confirmed_at)
     VALUES (?, 'wechat_pay', ?, 'confirmed', 1000, 1, JSON_OBJECT('test', 1), CURRENT_TIMESTAMP)`,
    [ins.insertId, unique("ptxn")]
  );
  return { orderId: ins.insertId, paymentId: pay.insertId };
}

async function cleanupOrder(orderId) {
  await pool.query("DELETE FROM ledger_entries WHERE order_id = ?", [orderId]);
  await pool.query("DELETE FROM refunds WHERE order_id = ?", [orderId]);
  await pool.query("DELETE FROM payments WHERE order_id = ?", [orderId]);
  await pool.query("DELETE FROM queue_jobs WHERE idempotency_key LIKE ?", [`refund:${orderId}:%`]);
  await pool.query("DELETE FROM orders WHERE id = ?", [orderId]);
}

describeDb("Payments endpoints", () => {
  describe("POST /api/v1/payments/imports", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().post("/api/v1/payments/imports").send({ fileName: "x.csv", content: "x" });
      expect(res.status).toBe(401);
    });

    test("403 regular user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/payments/imports").send({ fileName: "x.csv", content: "x" });
      expect(res.status).toBe(403);
    });

    test("403 coach", async () => {
      const coach = await loginAsCoach();
      const res = await coach.post("/api/v1/payments/imports").send({ fileName: "x.csv", content: "x" });
      expect(res.status).toBe(403);
    });

    test("400 missing file content", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.post("/api/v1/payments/imports").send({ fileName: "x.csv" });
      expect(res.status).toBe(400);
    });

    test("400 invalid CSV header", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.post("/api/v1/payments/imports").send({ fileName: "bad.csv", content: "wrong,header\n1,2" });
      expect(res.status).toBe(400);
    });

    test("201 valid CSV with signature creates import and queues job", async () => {
      const athleteId = await getUserId("athlete1");
      const { orderId } = await createPaidOrder(athleteId);
      const importId = null;
      try {
        const supp = await loginAsSupport();
        const occurredAt = new Date().toISOString();
        const content = [
          CSV_HEADER,
          buildRow({ orderId, providerTxnId: unique("txn"), amountCents: 1000, status: "SUCCESS", occurredAt })
        ].join("\n");
        const res = await supp.post("/api/v1/payments/imports").send({ fileName: "ok.csv", content });
        expect(res.status).toBe(201);
        expect(res.body.data.signatureVerified).toBe(true);
        expect(res.body.data.records).toBe(1);
        expect(res.body.data.duplicate).toBe(false);

        const [jobs] = await pool.query("SELECT job_type FROM queue_jobs WHERE idempotency_key LIKE ?", [`payment_apply:${res.body.data.importId}:%`]);
        expect(jobs.length).toBe(1);

        await pool.query("DELETE FROM queue_jobs WHERE idempotency_key LIKE ?", [`payment_apply:${res.body.data.importId}:%`]);
        await pool.query("DELETE FROM payment_reconciliation_imports WHERE id = ?", [res.body.data.importId]);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test("duplicate import returns existing without re-queueing", async () => {
      const athleteId = await getUserId("athlete1");
      const { orderId } = await createPaidOrder(athleteId);
      try {
        const supp = await loginAsSupport();
        const occurredAt = new Date().toISOString();
        const content = [
          CSV_HEADER,
          buildRow({ orderId, providerTxnId: unique("dup"), amountCents: 1000, status: "SUCCESS", occurredAt })
        ].join("\n");
        const r1 = await supp.post("/api/v1/payments/imports").send({ fileName: "d1.csv", content });
        expect(r1.status).toBe(201);

        const r2 = await supp.post("/api/v1/payments/imports").send({ fileName: "d2.csv", content });
        expect(r2.status).toBe(200);
        expect(r2.body.data.duplicate).toBe(true);
        expect(r2.body.data.importId).toBe(r1.body.data.importId);

        await pool.query("DELETE FROM queue_jobs WHERE idempotency_key LIKE ?", [`payment_apply:${r1.body.data.importId}:%`]);
        await pool.query("DELETE FROM payment_reconciliation_imports WHERE id = ?", [r1.body.data.importId]);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test("invalid signature flagged as signatureVerified=false", async () => {
      const athleteId = await getUserId("athlete1");
      const { orderId } = await createPaidOrder(athleteId);
      try {
        const supp = await loginAsSupport();
        const occurredAt = new Date().toISOString();
        const content = [
          CSV_HEADER,
          `${orderId},${unique("bad")},1000,SUCCESS,${occurredAt},invalidsignature`
        ].join("\n");
        const res = await supp.post("/api/v1/payments/imports").send({ fileName: "bad.csv", content });
        expect(res.status).toBe(201);
        expect(res.body.data.signatureVerified).toBe(false);

        await pool.query("DELETE FROM queue_jobs WHERE idempotency_key LIKE ?", [`payment_apply:${res.body.data.importId}:%`]);
        await pool.query("DELETE FROM payment_reconciliation_imports WHERE id = ?", [res.body.data.importId]);
      } finally {
        await cleanupOrder(orderId);
      }
    });
  });

  describe("GET /api/v1/payments/imports/:importId", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/payments/imports/1");
      expect(res.status).toBe(401);
    });
    test("403 regular user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/payments/imports/1");
      expect(res.status).toBe(403);
    });
    test("400 non-numeric id", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/payments/imports/abc");
      expect(res.status).toBe(400);
    });
    test("404 non-existent", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.get("/api/v1/payments/imports/999999");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/v1/payments/orders/:id/refunds", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().post("/api/v1/payments/orders/1/refunds").send({
        amountDollars: 1, reason: "test", idempotencyKey: "k"
      });
      expect(res.status).toBe(401);
    });

    test("403 regular user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/payments/orders/1/refunds").send({
        amountDollars: 1, reason: "test", idempotencyKey: unique("k")
      });
      expect(res.status).toBe(403);
    });

    test("400 invalid amount", async () => {
      const admin = await loginAsAdmin();
      const res = await admin.post("/api/v1/payments/orders/1/refunds").send({
        amountDollars: -1, reason: "x", idempotencyKey: unique("k")
      });
      expect(res.status).toBe(400);
    });

    test("201 support partial refund persists DB side effects", async () => {
      const athleteId = await getUserId("athlete1");
      const { orderId, paymentId } = await createPaidOrder(athleteId);
      try {
        const supp = await loginAsSupport();
        const res = await supp.post(`/api/v1/payments/orders/${orderId}/refunds`).send({
          amountDollars: 3.0, reason: "policy", idempotencyKey: unique("refk")
        });
        expect(res.status).toBe(201);

        const [refunds] = await pool.query("SELECT id, refund_status, amount_cents FROM refunds WHERE order_id = ?", [orderId]);
        expect(refunds.length).toBe(1);
        expect(refunds[0].amount_cents).toBe(300);

        const [orderRows] = await pool.query("SELECT refunded_amount_cents, order_status FROM orders WHERE id = ?", [orderId]);
        expect(orderRows[0].refunded_amount_cents).toBe(300);
        expect(orderRows[0].order_status).toBe("refund_partial");

        const [payRows] = await pool.query("SELECT payment_status FROM payments WHERE id = ?", [paymentId]);
        expect(payRows[0].payment_status).toBe("refunded_partial");

        const [ledger] = await pool.query("SELECT entry_type, amount_cents FROM ledger_entries WHERE refund_id = ?", [refunds[0].id]);
        expect(ledger.length).toBe(1);
        expect(ledger[0].entry_type).toBe("refund_credit");
        expect(ledger[0].amount_cents).toBe(-300);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test("full refund sets order to refund_full", async () => {
      const athleteId = await getUserId("athlete1");
      const { orderId } = await createPaidOrder(athleteId);
      try {
        const supp = await loginAsSupport();
        const res = await supp.post(`/api/v1/payments/orders/${orderId}/refunds`).send({
          amountDollars: 10.0, reason: "full refund", idempotencyKey: unique("refk")
        });
        expect(res.status).toBe(201);

        const [rows] = await pool.query("SELECT order_status, refunded_amount_cents FROM orders WHERE id = ?", [orderId]);
        expect(rows[0].order_status).toBe("refund_full");
        expect(rows[0].refunded_amount_cents).toBe(1000);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test("400 refund exceeds remaining amount", async () => {
      const athleteId = await getUserId("athlete1");
      const { orderId } = await createPaidOrder(athleteId);
      try {
        const supp = await loginAsSupport();
        const res = await supp.post(`/api/v1/payments/orders/${orderId}/refunds`).send({
          amountDollars: 100.0, reason: "too much", idempotencyKey: unique("refk")
        });
        expect(res.status).toBe(400);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test("idempotent refund request", async () => {
      const athleteId = await getUserId("athlete1");
      const { orderId } = await createPaidOrder(athleteId);
      try {
        const supp = await loginAsSupport();
        const key = unique("idemref");
        const r1 = await supp.post(`/api/v1/payments/orders/${orderId}/refunds`).send({
          amountDollars: 2.0, reason: "first", idempotencyKey: key
        });
        expect(r1.status).toBe(201);

        const r2 = await supp.post(`/api/v1/payments/orders/${orderId}/refunds`).send({
          amountDollars: 2.0, reason: "second", idempotencyKey: key
        });
        expect(r2.status).toBe(201);
        expect(r2.body.data.id).toBe(r1.body.data.id);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test("404 non-existent order", async () => {
      const supp = await loginAsSupport();
      const res = await supp.post("/api/v1/payments/orders/999999/refunds").send({
        amountDollars: 1.0, reason: "x", idempotencyKey: unique("k")
      });
      expect(res.status).toBe(404);
    });
  });
});
