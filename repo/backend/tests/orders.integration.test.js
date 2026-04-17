const { describeDb, pool, unauth, unique, loginAsAthlete, loginAsCoach, loginAsSupport, loginAsAdmin, getUserId } = require("./helpers/integration-helpers");

async function getCatalogItem(kind) {
  const [rows] = await pool.query("SELECT id FROM courses_services WHERE status = 'active' AND kind = ? LIMIT 1", [kind]);
  return rows[0]?.id;
}

describeDb("Orders endpoints", () => {
  describe("POST /api/v1/orders", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().post("/api/v1/orders").send({});
      expect(res.status).toBe(401);
    });

    test("400 missing fields", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/orders").send({ courseServiceId: 1 });
      expect(res.status).toBe(400);
    });

    test("400 idempotencyKey too short", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/orders").send({
        courseServiceId: 1, orderType: "course", totalAmountDollars: 10, idempotencyKey: "ab"
      });
      expect(res.status).toBe(400);
    });

    test("404 non-existent course", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/orders").send({
        courseServiceId: 9999999, orderType: "course", totalAmountDollars: 10, idempotencyKey: unique("key")
      });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("COURSE_SERVICE_NOT_FOUND");
    });

    test("400 orderType mismatch", async () => {
      const agent = await loginAsAthlete();
      const courseId = await getCatalogItem("course");
      const res = await agent.post("/api/v1/orders").send({
        courseServiceId: courseId, orderType: "service", totalAmountDollars: 10, idempotencyKey: unique("key")
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("ORDER_TYPE_MISMATCH");
    });

    test("201 creates order in pending_payment with cancel job queued", async () => {
      const agent = await loginAsAthlete();
      const courseId = await getCatalogItem("course");
      const key = unique("orderkey");
      const res = await agent.post("/api/v1/orders").send({
        courseServiceId: courseId, orderType: "course", totalAmountDollars: 25, idempotencyKey: key
      });
      expect(res.status).toBe(201);
      expect(res.body.data.order_status).toBe("pending_payment");
      expect(res.body.data.total_amount_cents).toBe(2500);

      const [jobs] = await pool.query("SELECT job_type FROM queue_jobs WHERE idempotency_key = ?", [`cancel_unpaid_order:${res.body.data.id}`]);
      expect(jobs.length).toBe(1);
      expect(jobs[0].job_type).toBe("cancel_unpaid_order");

      await pool.query("DELETE FROM queue_jobs WHERE idempotency_key = ?", [`cancel_unpaid_order:${res.body.data.id}`]);
      await pool.query("DELETE FROM orders WHERE id = ?", [res.body.data.id]);
    });

    test("idempotent create returns existing order", async () => {
      const agent = await loginAsAthlete();
      const courseId = await getCatalogItem("course");
      const key = unique("idemkey");
      const r1 = await agent.post("/api/v1/orders").send({
        courseServiceId: courseId, orderType: "course", totalAmountDollars: 10, idempotencyKey: key
      });
      const r2 = await agent.post("/api/v1/orders").send({
        courseServiceId: courseId, orderType: "course", totalAmountDollars: 10, idempotencyKey: key
      });
      expect(r2.body.data.id).toBe(r1.body.data.id);

      await pool.query("DELETE FROM queue_jobs WHERE idempotency_key = ?", [`cancel_unpaid_order:${r1.body.data.id}`]);
      await pool.query("DELETE FROM orders WHERE id = ?", [r1.body.data.id]);
    });
  });

  describe("GET /api/v1/orders", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/orders");
      expect(res.status).toBe(401);
    });

    test("200 regular user sees only own orders", async () => {
      const agent = await loginAsAthlete();
      const athleteId = await getUserId("athlete1");
      const res = await agent.get("/api/v1/orders");
      expect(res.status).toBe(200);
      for (const o of res.body.data) {
        expect(o.user_id).toBe(athleteId);
      }
    });

    test("admin sees all orders", async () => {
      const courseId = await getCatalogItem("course");
      const coachId = await getUserId("coach1");
      const [ins] = await pool.query(
        `INSERT INTO orders (user_id, course_service_id, order_type, order_status, total_amount_cents, idempotency_key)
         VALUES (?, ?, 'course', 'pending_payment', 1000, ?)`,
        [coachId, courseId, unique("admorder")]
      );
      try {
        const admin = await loginAsAdmin();
        const res = await admin.get("/api/v1/orders");
        expect(res.body.data.find((o) => o.id === ins.insertId)).toBeDefined();
      } finally {
        await pool.query("DELETE FROM orders WHERE id = ?", [ins.insertId]);
      }
    });
  });

  describe("GET /api/v1/orders/:id", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/orders/1");
      expect(res.status).toBe(401);
    });

    test("400 non-numeric id", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/orders/abc");
      expect(res.status).toBe(400);
    });

    test("404 non-existent", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/orders/999999");
      expect(res.status).toBe(404);
    });

    test("403 cross-user (IDOR)", async () => {
      const courseId = await getCatalogItem("course");
      const coachId = await getUserId("coach1");
      const [ins] = await pool.query(
        `INSERT INTO orders (user_id, course_service_id, order_type, order_status, total_amount_cents, idempotency_key)
         VALUES (?, ?, 'course', 'pending_payment', 1000, ?)`,
        [coachId, courseId, unique("idor")]
      );
      try {
        const athleteAgent = await loginAsAthlete();
        const res = await athleteAgent.get(`/api/v1/orders/${ins.insertId}`);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("FORBIDDEN");
      } finally {
        await pool.query("DELETE FROM orders WHERE id = ?", [ins.insertId]);
      }
    });

    test("200 support user can access any order", async () => {
      const courseId = await getCatalogItem("course");
      const coachId = await getUserId("coach1");
      const [ins] = await pool.query(
        `INSERT INTO orders (user_id, course_service_id, order_type, order_status, total_amount_cents, idempotency_key)
         VALUES (?, ?, 'course', 'pending_payment', 1000, ?)`,
        [coachId, courseId, unique("suprd")]
      );
      try {
        const supp = await loginAsSupport();
        const res = await supp.get(`/api/v1/orders/${ins.insertId}`);
        expect(res.status).toBe(200);
      } finally {
        await pool.query("DELETE FROM orders WHERE id = ?", [ins.insertId]);
      }
    });
  });

  describe("GET /api/v1/orders/:id/payment-status", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/orders/1/payment-status");
      expect(res.status).toBe(401);
    });

    test("200 owner sees payment status", async () => {
      const athleteId = await getUserId("athlete1");
      const courseId = await getCatalogItem("course");
      const [ins] = await pool.query(
        `INSERT INTO orders (user_id, course_service_id, order_type, order_status, total_amount_cents, paid_amount_cents, idempotency_key)
         VALUES (?, ?, 'course', 'paid', 1000, 1000, ?)`,
        [athleteId, courseId, unique("ps")]
      );
      try {
        const agent = await loginAsAthlete();
        const res = await agent.get(`/api/v1/orders/${ins.insertId}/payment-status`);
        expect(res.status).toBe(200);
        expect(res.body.data.orderStatus).toBe("paid");
        expect(res.body.data.paidAmountCents).toBe(1000);
      } finally {
        await pool.query("DELETE FROM orders WHERE id = ?", [ins.insertId]);
      }
    });
  });

  describe("POST /api/v1/orders/:id/complete", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().post("/api/v1/orders/1/complete");
      expect(res.status).toBe(401);
    });

    test("403 regular user cannot complete", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/orders/1/complete");
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    test("coach/support/admin can complete a paid order", async () => {
      const athleteId = await getUserId("athlete1");
      const courseId = await getCatalogItem("course");
      const [ins] = await pool.query(
        `INSERT INTO orders (user_id, course_service_id, order_type, order_status, total_amount_cents, paid_amount_cents, idempotency_key)
         VALUES (?, ?, 'course', 'paid', 1000, 1000, ?)`,
        [athleteId, courseId, unique("compl")]
      );
      try {
        const supp = await loginAsSupport();
        const res = await supp.post(`/api/v1/orders/${ins.insertId}/complete`);
        expect(res.status).toBe(200);

        const [rows] = await pool.query("SELECT order_status FROM orders WHERE id = ?", [ins.insertId]);
        expect(rows[0].order_status).toBe("completed");
      } finally {
        await pool.query("DELETE FROM orders WHERE id = ?", [ins.insertId]);
      }
    });
  });
});
