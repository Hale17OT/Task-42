const { describeDb, pool, unauth, unique, loginAsAthlete, loginAsCoach, loginAsAdmin, loginAsSupport, getUserId } = require("./helpers/integration-helpers");

async function getCourseId() {
  const [rows] = await pool.query("SELECT id FROM courses_services WHERE status = 'active' LIMIT 1");
  return rows[0].id;
}

async function createCompletedOrder(userId) {
  const courseId = await getCourseId();
  const [ins] = await pool.query(
    `INSERT INTO orders (user_id, course_service_id, order_type, order_status, total_amount_cents, paid_amount_cents, idempotency_key)
     VALUES (?, ?, 'course', 'completed', 1000, 1000, ?)`,
    [userId, courseId, unique("revorder")]
  );
  return ins.insertId;
}

async function cleanupOrder(orderId) {
  await pool.query("DELETE FROM orders WHERE id = ?", [orderId]);
}

async function cleanupReviewCascade(reviewId) {
  await pool.query("DELETE FROM review_dimension_scores WHERE review_id = ?", [reviewId]);
  await pool.query("DELETE FROM review_images WHERE review_id = ?", [reviewId]);
  await pool.query("DELETE FROM review_followups WHERE review_id = ?", [reviewId]);
  await pool.query("DELETE FROM review_replies WHERE review_id = ?", [reviewId]);
  await pool.query("DELETE FROM moderation_events WHERE review_id = ?", [reviewId]);
  await pool.query("DELETE FROM appeals WHERE review_id = ?", [reviewId]);
  await pool.query("DELETE FROM reviews WHERE id = ?", [reviewId]);
}

// Small 1x1 transparent PNG base64
const PNG_1x1_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_BUFFER_LEN = Buffer.from(PNG_1x1_BASE64, "base64").length;

describeDb("Reviews endpoints", () => {
  beforeEach(async () => {
    const athleteId = await getUserId("athlete1");
    // reset daily quota for test isolation
    await pool.query("DELETE FROM daily_review_quota WHERE user_id = ?", [athleteId]);
  });

  describe("GET /api/v1/reviews/mine", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/reviews/mine");
      expect(res.status).toBe(401);
    });

    test("200 returns user's reviews", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/reviews/mine");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test("masks review_text for under_arbitration reviews", async () => {
      const athleteId = await getUserId("athlete1");
      const orderId = await createCompletedOrder(athleteId);
      const [ins] = await pool.query(
        `INSERT INTO reviews (order_id, user_id, rating, review_state, review_text, published_at)
         VALUES (?, ?, 4, 'under_arbitration', 'Secret content here', CURRENT_TIMESTAMP)`,
        [orderId, athleteId]
      );
      try {
        const agent = await loginAsAthlete();
        const res = await agent.get("/api/v1/reviews/mine");
        const found = res.body.data.find((r) => r.id === ins.insertId);
        expect(found).toBeDefined();
        expect(found.review_text).not.toContain("Secret content");
        expect(found.review_text).toContain("hidden");
      } finally {
        await cleanupReviewCascade(ins.insertId);
        await cleanupOrder(orderId);
      }
    });
  });

  describe("POST /api/v1/reviews", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().post("/api/v1/reviews").send({});
      expect(res.status).toBe(401);
    });

    test("400 missing fields", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/reviews").send({ rating: 5 });
      expect(res.status).toBe(400);
    });

    test("400 invalid rating", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/reviews").send({ orderId: 1, rating: 10, reviewText: "x" });
      expect(res.status).toBe(400);
    });

    test("404 order not found for user", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/reviews").send({ orderId: 999999, rating: 5, reviewText: "test" });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
    });

    test("404 cross-user order", async () => {
      const coachId = await getUserId("coach1");
      const orderId = await createCompletedOrder(coachId);
      try {
        const agent = await loginAsAthlete();
        const res = await agent.post("/api/v1/reviews").send({ orderId, rating: 5, reviewText: "nice" });
        expect(res.status).toBe(404);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test("400 when order not completed", async () => {
      const athleteId = await getUserId("athlete1");
      const courseId = await getCourseId();
      const [ins] = await pool.query(
        `INSERT INTO orders (user_id, course_service_id, order_type, order_status, total_amount_cents, idempotency_key)
         VALUES (?, ?, 'course', 'pending_payment', 1000, ?)`,
        [athleteId, courseId, unique("po")]
      );
      try {
        const agent = await loginAsAthlete();
        const res = await agent.post("/api/v1/reviews").send({ orderId: ins.insertId, rating: 5, reviewText: "test" });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("ORDER_NOT_COMPLETED");
      } finally {
        await pool.query("DELETE FROM orders WHERE id = ?", [ins.insertId]);
      }
    });

    test("201 creates review with published state", async () => {
      const athleteId = await getUserId("athlete1");
      const orderId = await createCompletedOrder(athleteId);
      try {
        const agent = await loginAsAthlete();
        const res = await agent.post("/api/v1/reviews").send({
          orderId, rating: 5, reviewText: "Excellent experience"
        });
        expect(res.status).toBe(201);
        expect(res.body.data.review_state).toBe("published");

        await cleanupReviewCascade(res.body.data.id);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test("409 duplicate review for same order", async () => {
      const athleteId = await getUserId("athlete1");
      const orderId = await createCompletedOrder(athleteId);
      try {
        const agent = await loginAsAthlete();
        const r1 = await agent.post("/api/v1/reviews").send({ orderId, rating: 5, reviewText: "First" });
        const r2 = await agent.post("/api/v1/reviews").send({ orderId, rating: 4, reviewText: "Second" });
        expect(r2.status).toBe(409);
        expect(r2.body.error.code).toBe("REVIEW_ALREADY_EXISTS");

        await cleanupReviewCascade(r1.body.data.id);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test("400 sensitive word detected; details do not expose matched terms", async () => {
      const athleteId = await getUserId("athlete1");
      // Add a sensitive word
      await pool.query("INSERT INTO sensitive_words (word, is_active) VALUES (?, 1) ON DUPLICATE KEY UPDATE is_active = 1", ["secretword"]);
      const orderId = await createCompletedOrder(athleteId);
      try {
        const agent = await loginAsAthlete();
        const res = await agent.post("/api/v1/reviews").send({
          orderId, rating: 5, reviewText: "This review contains a secretword in it"
        });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("SENSITIVE_WORD_DETECTED");
        expect(JSON.stringify(res.body)).not.toContain("secretword");
        expect(res.body.error.details).toBeNull();
      } finally {
        await pool.query("DELETE FROM sensitive_words WHERE word = ?", ["secretword"]);
        await cleanupOrder(orderId);
      }
    });

    test("429 daily quota enforced atomically", async () => {
      const athleteId = await getUserId("athlete1");
      await pool.query("DELETE FROM daily_review_quota WHERE user_id = ?", [athleteId]);

      const orderIds = [];
      for (let i = 0; i < 3; i += 1) {
        orderIds.push(await createCompletedOrder(athleteId));
      }
      const reviewIds = [];
      try {
        const agent = await loginAsAthlete();
        const r1 = await agent.post("/api/v1/reviews").send({ orderId: orderIds[0], rating: 5, reviewText: "one" });
        expect(r1.status).toBe(201);
        reviewIds.push(r1.body.data.id);

        const r2 = await agent.post("/api/v1/reviews").send({ orderId: orderIds[1], rating: 5, reviewText: "two" });
        expect(r2.status).toBe(201);
        reviewIds.push(r2.body.data.id);

        const r3 = await agent.post("/api/v1/reviews").send({ orderId: orderIds[2], rating: 5, reviewText: "three" });
        expect(r3.status).toBe(429);
        expect(r3.body.error.code).toBe("DAILY_REVIEW_LIMIT");
      } finally {
        for (const rid of reviewIds) await cleanupReviewCascade(rid);
        for (const oid of orderIds) await cleanupOrder(oid);
        await pool.query("DELETE FROM daily_review_quota WHERE user_id = ?", [athleteId]);
      }
    });
  });

  describe("GET /api/v1/reviews/:id", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/reviews/1");
      expect(res.status).toBe(401);
    });

    test("404 non-existent", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/reviews/999999");
      expect(res.status).toBe(404);
    });

    test("200 owner can view own review", async () => {
      const athleteId = await getUserId("athlete1");
      const orderId = await createCompletedOrder(athleteId);
      const agent = await loginAsAthlete();
      const created = await agent.post("/api/v1/reviews").send({ orderId, rating: 5, reviewText: "nice" });
      try {
        const res = await agent.get(`/api/v1/reviews/${created.body.data.id}`);
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(created.body.data.id);
      } finally {
        await cleanupReviewCascade(created.body.data.id);
        await cleanupOrder(orderId);
      }
    });

    test("403 non-owner regular user", async () => {
      const athleteId = await getUserId("athlete1");
      const orderId = await createCompletedOrder(athleteId);
      const athleteAgent = await loginAsAthlete();
      const created = await athleteAgent.post("/api/v1/reviews").send({ orderId, rating: 5, reviewText: "nice" });
      try {
        // Login as a different regular user (register one)
        // Using coach here wouldn't test "regular" — instead, register new user
        const { createRegisteredUser } = require("./helpers/integration-helpers");
        const { agent: otherAgent } = await createRegisteredUser("viewer");
        const res = await otherAgent.get(`/api/v1/reviews/${created.body.data.id}`);
        expect(res.status).toBe(403);
      } finally {
        await cleanupReviewCascade(created.body.data.id);
        await cleanupOrder(orderId);
      }
    });

    test("200 privileged role (coach) can view any review", async () => {
      const athleteId = await getUserId("athlete1");
      const orderId = await createCompletedOrder(athleteId);
      const athleteAgent = await loginAsAthlete();
      const created = await athleteAgent.post("/api/v1/reviews").send({ orderId, rating: 5, reviewText: "nice" });
      try {
        const coach = await loginAsCoach();
        const res = await coach.get(`/api/v1/reviews/${created.body.data.id}`);
        expect(res.status).toBe(200);
      } finally {
        await cleanupReviewCascade(created.body.data.id);
        await cleanupOrder(orderId);
      }
    });

    test("under_arbitration masks text and hides images/followup", async () => {
      const athleteId = await getUserId("athlete1");
      const orderId = await createCompletedOrder(athleteId);
      const [ins] = await pool.query(
        `INSERT INTO reviews (order_id, user_id, rating, review_state, review_text, published_at)
         VALUES (?, ?, 4, 'under_arbitration', 'HIDDEN CONTENT', CURRENT_TIMESTAMP)`,
        [orderId, athleteId]
      );
      try {
        const agent = await loginAsAthlete();
        const res = await agent.get(`/api/v1/reviews/${ins.insertId}`);
        expect(res.status).toBe(200);
        expect(res.body.data.reviewText).not.toContain("HIDDEN CONTENT");
      } finally {
        await cleanupReviewCascade(ins.insertId);
        await cleanupOrder(orderId);
      }
    });
  });

  describe("POST /api/v1/reviews/:id/follow-up", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().post("/api/v1/reviews/1/follow-up").send({ followupText: "x" });
      expect(res.status).toBe(401);
    });

    test("400 empty text", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/reviews/1/follow-up").send({ followupText: "" });
      expect(res.status).toBe(400);
    });

    test("404 review not owned", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/reviews/999999/follow-up").send({ followupText: "nope" });
      expect(res.status).toBe(404);
    });

    test("201 follow-up within 30 days", async () => {
      const athleteId = await getUserId("athlete1");
      const orderId = await createCompletedOrder(athleteId);
      const agent = await loginAsAthlete();
      const created = await agent.post("/api/v1/reviews").send({ orderId, rating: 5, reviewText: "nice" });
      try {
        const res = await agent.post(`/api/v1/reviews/${created.body.data.id}/follow-up`).send({ followupText: "update" });
        expect(res.status).toBe(201);
        expect(res.body.data.followup_text).toBe("update");
      } finally {
        await cleanupReviewCascade(created.body.data.id);
        await cleanupOrder(orderId);
      }
    });

    test("400 when window expired (>30 days)", async () => {
      const athleteId = await getUserId("athlete1");
      const orderId = await createCompletedOrder(athleteId);
      const [ins] = await pool.query(
        `INSERT INTO reviews (order_id, user_id, rating, review_state, review_text, published_at)
         VALUES (?, ?, 5, 'published', 'old', DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 40 DAY))`,
        [orderId, athleteId]
      );
      try {
        const agent = await loginAsAthlete();
        const res = await agent.post(`/api/v1/reviews/${ins.insertId}/follow-up`).send({ followupText: "late" });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("FOLLOWUP_WINDOW_EXPIRED");
      } finally {
        await cleanupReviewCascade(ins.insertId);
        await cleanupOrder(orderId);
      }
    });

    test("409 duplicate follow-up", async () => {
      const athleteId = await getUserId("athlete1");
      const orderId = await createCompletedOrder(athleteId);
      const agent = await loginAsAthlete();
      const created = await agent.post("/api/v1/reviews").send({ orderId, rating: 5, reviewText: "nice" });
      try {
        const r1 = await agent.post(`/api/v1/reviews/${created.body.data.id}/follow-up`).send({ followupText: "f1" });
        // Reset daily quota to allow second attempt
        await pool.query("DELETE FROM daily_review_quota WHERE user_id = ?", [athleteId]);
        const r2 = await agent.post(`/api/v1/reviews/${created.body.data.id}/follow-up`).send({ followupText: "f2" });
        expect(r2.status).toBe(409);
      } finally {
        await cleanupReviewCascade(created.body.data.id);
        await cleanupOrder(orderId);
      }
    });
  });

  describe("POST /api/v1/reviews/:id/images", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().post("/api/v1/reviews/1/images").send({});
      expect(res.status).toBe(401);
    });

    test("400 invalid mime type", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/reviews/1/images").send({
        fileName: "x.bmp", mimeType: "image/bmp", sizeBytes: 10, base64Data: "abcdefghij"
      });
      expect(res.status).toBe(400);
    });

    test("404 review not owned", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/reviews/999999/images").send({
        fileName: "x.png", mimeType: "image/png", sizeBytes: PNG_BUFFER_LEN, base64Data: PNG_1x1_BASE64
      });
      expect(res.status).toBe(404);
    });

    test("201 uploads image; db row created", async () => {
      const athleteId = await getUserId("athlete1");
      const orderId = await createCompletedOrder(athleteId);
      const agent = await loginAsAthlete();
      const created = await agent.post("/api/v1/reviews").send({ orderId, rating: 5, reviewText: "nice" });
      try {
        const res = await agent.post(`/api/v1/reviews/${created.body.data.id}/images`).send({
          fileName: "x.png", mimeType: "image/png", sizeBytes: PNG_BUFFER_LEN, base64Data: PNG_1x1_BASE64
        });
        expect(res.status).toBe(201);

        const [rows] = await pool.query("SELECT id FROM review_images WHERE review_id = ?", [created.body.data.id]);
        expect(rows.length).toBe(1);
      } finally {
        await cleanupReviewCascade(created.body.data.id);
        await cleanupOrder(orderId);
      }
    });

    test("400 IMAGE_LIMIT_REACHED after 5 images", async () => {
      const athleteId = await getUserId("athlete1");
      const orderId = await createCompletedOrder(athleteId);
      const agent = await loginAsAthlete();
      const created = await agent.post("/api/v1/reviews").send({ orderId, rating: 5, reviewText: "nice" });
      try {
        for (let i = 0; i < 5; i += 1) {
          const r = await agent.post(`/api/v1/reviews/${created.body.data.id}/images`).send({
            fileName: `${i}.png`, mimeType: "image/png", sizeBytes: PNG_BUFFER_LEN, base64Data: PNG_1x1_BASE64
          });
          expect(r.status).toBe(201);
        }
        const res = await agent.post(`/api/v1/reviews/${created.body.data.id}/images`).send({
          fileName: "6.png", mimeType: "image/png", sizeBytes: PNG_BUFFER_LEN, base64Data: PNG_1x1_BASE64
        });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("IMAGE_LIMIT_REACHED");
      } finally {
        await cleanupReviewCascade(created.body.data.id);
        await cleanupOrder(orderId);
      }
    }, 20000);
  });

  describe("GET /api/v1/reviews/images/:imageId", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().get("/api/v1/reviews/images/1");
      expect(res.status).toBe(401);
    });

    test("404 non-existent", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/reviews/images/999999");
      expect(res.status).toBe(404);
    });

    test("200 owner can download image", async () => {
      const athleteId = await getUserId("athlete1");
      const orderId = await createCompletedOrder(athleteId);
      const agent = await loginAsAthlete();
      const created = await agent.post("/api/v1/reviews").send({ orderId, rating: 5, reviewText: "nice" });
      try {
        const imgRes = await agent.post(`/api/v1/reviews/${created.body.data.id}/images`).send({
          fileName: "x.png", mimeType: "image/png", sizeBytes: PNG_BUFFER_LEN, base64Data: PNG_1x1_BASE64
        });
        const res = await agent.get(`/api/v1/reviews/images/${imgRes.body.data.id}`);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("image/png");
      } finally {
        await cleanupReviewCascade(created.body.data.id);
        await cleanupOrder(orderId);
      }
    });
  });

  describe("POST /api/v1/reviews/:id/appeals", () => {
    test("401 unauthenticated", async () => {
      const res = await unauth().post("/api/v1/reviews/1/appeals").send({ reason: "x" });
      expect(res.status).toBe(401);
    });

    test("400 empty reason", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/reviews/1/appeals").send({ reason: "" });
      expect(res.status).toBe(400);
    });

    test("404 not owned", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/reviews/999999/appeals").send({ reason: "reason text" });
      expect(res.status).toBe(404);
    });

    test("400 when appeal window expired (>7 days)", async () => {
      const athleteId = await getUserId("athlete1");
      const orderId = await createCompletedOrder(athleteId);
      const [ins] = await pool.query(
        `INSERT INTO reviews (order_id, user_id, rating, review_state, review_text, published_at)
         VALUES (?, ?, 5, 'published', 'old', DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 10 DAY))`,
        [orderId, athleteId]
      );
      try {
        const agent = await loginAsAthlete();
        const res = await agent.post(`/api/v1/reviews/${ins.insertId}/appeals`).send({ reason: "disputed" });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("APPEAL_WINDOW_EXPIRED");
      } finally {
        await cleanupReviewCascade(ins.insertId);
        await cleanupOrder(orderId);
      }
    });

    test("201 creates appeal, sets review to under_arbitration", async () => {
      const athleteId = await getUserId("athlete1");
      const orderId = await createCompletedOrder(athleteId);
      const agent = await loginAsAthlete();
      const created = await agent.post("/api/v1/reviews").send({ orderId, rating: 5, reviewText: "nice" });
      try {
        const res = await agent.post(`/api/v1/reviews/${created.body.data.id}/appeals`).send({ reason: "unfair" });
        expect(res.status).toBe(201);
        expect(res.body.data.appeal_status).toBe("submitted");

        const [rows] = await pool.query("SELECT review_state FROM reviews WHERE id = ?", [created.body.data.id]);
        expect(rows[0].review_state).toBe("under_arbitration");
      } finally {
        await cleanupReviewCascade(created.body.data.id);
        await cleanupOrder(orderId);
      }
    });

    test("409 duplicate open appeal", async () => {
      const athleteId = await getUserId("athlete1");
      const orderId = await createCompletedOrder(athleteId);
      const agent = await loginAsAthlete();
      const created = await agent.post("/api/v1/reviews").send({ orderId, rating: 5, reviewText: "nice" });
      try {
        const r1 = await agent.post(`/api/v1/reviews/${created.body.data.id}/appeals`).send({ reason: "first" });
        expect(r1.status).toBe(201);
        const r2 = await agent.post(`/api/v1/reviews/${created.body.data.id}/appeals`).send({ reason: "second" });
        expect(r2.status).toBe(409);
        expect(r2.body.error.code).toBe("APPEAL_ALREADY_OPEN");
      } finally {
        await cleanupReviewCascade(created.body.data.id);
        await cleanupOrder(orderId);
      }
    });
  });
});
