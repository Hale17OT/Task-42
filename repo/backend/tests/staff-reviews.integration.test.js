const { describeDb, pool, unauth, unique, loginAsAthlete, loginAsCoach, loginAsSupport, loginAsAdmin, getUserId } = require("./helpers/integration-helpers");

async function createAppealFixture() {
  const athleteId = await getUserId("athlete1");
  const [courseRows] = await pool.query("SELECT id FROM courses_services WHERE status = 'active' LIMIT 1");
  const [orderIns] = await pool.query(
    `INSERT INTO orders (user_id, course_service_id, order_type, order_status, total_amount_cents, paid_amount_cents, idempotency_key)
     VALUES (?, ?, 'course', 'completed', 1000, 1000, ?)`,
    [athleteId, courseRows[0].id, unique("staffrv")]
  );
  const [reviewIns] = await pool.query(
    `INSERT INTO reviews (order_id, user_id, rating, review_state, review_text, published_at)
     VALUES (?, ?, 4, 'under_arbitration', 'Appeal target', CURRENT_TIMESTAMP)`,
    [orderIns.insertId, athleteId]
  );
  const [appealIns] = await pool.query(
    `INSERT INTO appeals (review_id, appellant_user_id, appeal_status, appeal_reason)
     VALUES (?, ?, 'submitted', 'disputed')`,
    [reviewIns.insertId, athleteId]
  );
  return { orderId: orderIns.insertId, reviewId: reviewIns.insertId, appealId: appealIns.insertId };
}

async function cleanupAppealFixture({ orderId, reviewId, appealId }) {
  await pool.query("DELETE FROM appeal_timeline_events WHERE appeal_id = ?", [appealId]);
  await pool.query("DELETE FROM appeals WHERE id = ?", [appealId]);
  await pool.query("DELETE FROM reviews WHERE id = ?", [reviewId]);
  await pool.query("DELETE FROM orders WHERE id = ?", [orderId]);
}

describeDb("Staff review endpoints", () => {
  describe("GET /api/v1/staff/reviews/appeals", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/staff/reviews/appeals");
      expect(res.status).toBe(401);
    });

    test("403 regular user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/staff/reviews/appeals");
      expect(res.status).toBe(403);
    });

    test("200 coach can list appeals", async () => {
      const coach = await loginAsCoach();
      const res = await coach.get("/api/v1/staff/reviews/appeals");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test("200 support can list appeals filtered by status", async () => {
      const supp = await loginAsSupport();
      const res = await supp.get("/api/v1/staff/reviews/appeals?status=submitted");
      expect(res.status).toBe(200);
      for (const appeal of res.body.data) {
        expect(appeal.appeal_status).toBe("submitted");
      }
    });

    test("400 invalid status query param", async () => {
      const coach = await loginAsCoach();
      const res = await coach.get("/api/v1/staff/reviews/appeals?status=bogus");
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/staff/reviews/replies", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().post("/api/v1/staff/reviews/replies").send({});
      expect(res.status).toBe(401);
    });

    test("403 regular user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/staff/reviews/replies").send({ reviewId: 1, replyText: "hi" });
      expect(res.status).toBe(403);
    });

    test("400 missing replyText", async () => {
      const coach = await loginAsCoach();
      const res = await coach.post("/api/v1/staff/reviews/replies").send({ reviewId: 1 });
      expect(res.status).toBe(400);
    });

    test("201 coach can reply to review", async () => {
      const fixture = await createAppealFixture();
      try {
        const coach = await loginAsCoach();
        const res = await coach.post("/api/v1/staff/reviews/replies").send({
          reviewId: fixture.reviewId, replyText: "Thanks for the feedback"
        });
        expect(res.status).toBe(201);
        expect(res.body.data.author_role).toBe("coach");

        const [rows] = await pool.query("SELECT id FROM review_replies WHERE review_id = ?", [fixture.reviewId]);
        expect(rows.length).toBe(1);
        await pool.query("DELETE FROM review_replies WHERE review_id = ?", [fixture.reviewId]);
      } finally {
        await cleanupAppealFixture(fixture);
      }
    });

    test("400 invalid parent reply", async () => {
      const fixture = await createAppealFixture();
      try {
        const coach = await loginAsCoach();
        const res = await coach.post("/api/v1/staff/reviews/replies").send({
          reviewId: fixture.reviewId, parentReplyId: 999999, replyText: "test"
        });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("INVALID_PARENT_REPLY");
      } finally {
        await cleanupAppealFixture(fixture);
      }
    });
  });

  describe("PATCH /api/v1/staff/reviews/appeals/:appealId", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().patch("/api/v1/staff/reviews/appeals/1").send({ appealStatus: "upheld" });
      expect(res.status).toBe(401);
    });

    test("403 regular user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.patch("/api/v1/staff/reviews/appeals/1").send({ appealStatus: "upheld" });
      expect(res.status).toBe(403);
    });

    test("400 invalid status", async () => {
      const coach = await loginAsCoach();
      const res = await coach.patch("/api/v1/staff/reviews/appeals/1").send({ appealStatus: "invalid" });
      expect(res.status).toBe(400);
    });

    test("404 non-existent appeal", async () => {
      const coach = await loginAsCoach();
      const res = await coach.patch("/api/v1/staff/reviews/appeals/999999").send({ appealStatus: "resolved" });
      expect(res.status).toBe(404);
    });

    test("200 support can update appeal status; review state changes", async () => {
      const fixture = await createAppealFixture();
      try {
        const supp = await loginAsSupport();
        const res = await supp.patch(`/api/v1/staff/reviews/appeals/${fixture.appealId}`).send({
          appealStatus: "resolved", note: "Reviewed and resolved"
        });
        expect(res.status).toBe(200);
        expect(res.body.data.appeal_status).toBe("resolved");

        const [rows] = await pool.query("SELECT review_state FROM reviews WHERE id = ?", [fixture.reviewId]);
        expect(rows[0].review_state).toBe("published");
      } finally {
        await cleanupAppealFixture(fixture);
      }
    });

    test("upheld status triggers review state = 'hidden'", async () => {
      const fixture = await createAppealFixture();
      try {
        const supp = await loginAsSupport();
        const res = await supp.patch(`/api/v1/staff/reviews/appeals/${fixture.appealId}`).send({
          appealStatus: "upheld", note: "policy violation"
        });
        expect(res.status).toBe(200);

        const [rows] = await pool.query("SELECT review_state FROM reviews WHERE id = ?", [fixture.reviewId]);
        expect(rows[0].review_state).toBe("hidden");
      } finally {
        await cleanupAppealFixture(fixture);
      }
    });
  });
});
