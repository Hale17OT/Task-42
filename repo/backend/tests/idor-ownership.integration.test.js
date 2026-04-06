const request = require("supertest");
const app = require("../src/app");
const { pool } = require("../src/db/pool");

const runDbTests = process.env.RUN_DB_TESTS === "1";
const describeDb = runDbTests ? describe : describe.skip;

function unique(label) {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

describeDb("Object ownership / IDOR integration", () => {
  test("cross-user cannot access another user's activity", async () => {
    const connection = await pool.getConnection();
    let activityId = null;

    try {
      const [users] = await connection.query(
        "SELECT id, username FROM users WHERE username IN ('athlete1', 'coach1')"
      );
      const owner = users.find((u) => u.username === "athlete1");
      const other = users.find((u) => u.username === "coach1");
      expect(Boolean(owner)).toBe(true);
      expect(Boolean(other)).toBe(true);

      const [insert] = await connection.query(
        `INSERT INTO activities (user_id, activity_type, duration_seconds, distance_miles, status)
         VALUES (?, 'running', 3600, 5.0, 'published')`,
        [owner.id]
      );
      activityId = insert.insertId;

      // Owner can access
      const ownerAgent = request.agent(app.callback());
      await ownerAgent.post("/api/v1/auth/login").send({ username: "athlete1", password: "athlete12345" });
      const ownerRes = await ownerAgent.get(`/api/v1/activities/${activityId}`);
      expect(ownerRes.status).toBe(200);

      // Other user cannot access
      const otherAgent = request.agent(app.callback());
      await otherAgent.post("/api/v1/auth/login").send({ username: "coach1", password: "coach12345" });
      const otherRes = await otherAgent.get(`/api/v1/activities/${activityId}`);
      expect(otherRes.status).toBe(404);
    } finally {
      if (activityId) {
        await connection.query("DELETE FROM activities WHERE id = ?", [activityId]);
      }
      connection.release();
    }
  }, 20000);

  test("cross-user cannot modify another user's saved place", async () => {
    const connection = await pool.getConnection();
    let placeId = null;

    try {
      const [users] = await connection.query(
        "SELECT id, username FROM users WHERE username IN ('athlete1', 'coach1')"
      );
      const owner = users.find((u) => u.username === "athlete1");
      expect(Boolean(owner)).toBe(true);

      const [insert] = await connection.query(
        `INSERT INTO saved_places (user_id, label, location_text)
         VALUES (?, ?, 'Test Location')`,
        [owner.id, unique("TestPlace")]
      );
      placeId = insert.insertId;

      // Other user cannot update
      const otherAgent = request.agent(app.callback());
      await otherAgent.post("/api/v1/auth/login").send({ username: "coach1", password: "coach12345" });
      const patchRes = await otherAgent
        .patch(`/api/v1/places/${placeId}`)
        .send({ label: "hacked" });
      expect(patchRes.status).toBe(404);

      // Other user cannot delete
      const deleteRes = await otherAgent.delete(`/api/v1/places/${placeId}`);
      expect(deleteRes.status).toBe(404);

      // Verify place unchanged
      const [rows] = await connection.query("SELECT label FROM saved_places WHERE id = ?", [placeId]);
      expect(rows[0].label).not.toBe("hacked");
    } finally {
      if (placeId) {
        await connection.query("DELETE FROM saved_places WHERE id = ?", [placeId]);
      }
      connection.release();
    }
  }, 20000);

  test("cross-user cannot view another user's order (non-staff)", async () => {
    const connection = await pool.getConnection();
    let orderId = null;
    let courseId = null;

    try {
      const [users] = await connection.query(
        "SELECT id, username FROM users WHERE username IN ('athlete1', 'coach1', 'support1')"
      );
      const owner = users.find((u) => u.username === "athlete1");
      const nonStaffOther = users.find((u) => u.username === "coach1");
      const support = users.find((u) => u.username === "support1");

      const [courseInsert] = await connection.query(
        `INSERT INTO courses_services (kind, title, description, provider_user_id, status)
         VALUES ('service', ?, 'idor test', ?, 'active')`,
        [unique("IDOR Test"), support.id]
      );
      courseId = courseInsert.insertId;

      const [orderInsert] = await connection.query(
        `INSERT INTO orders (user_id, course_service_id, order_type, order_status,
         total_amount_cents, paid_amount_cents, refunded_amount_cents, currency, idempotency_key)
         VALUES (?, ?, 'service', 'paid', 1000, 1000, 0, 'USD', ?)`,
        [owner.id, courseId, unique("idor-order")]
      );
      orderId = orderInsert.insertId;

      // Owner can access
      const ownerAgent = request.agent(app.callback());
      await ownerAgent.post("/api/v1/auth/login").send({ username: "athlete1", password: "athlete12345" });
      const ownerRes = await ownerAgent.get(`/api/v1/orders/${orderId}`);
      expect(ownerRes.status).toBe(200);

      // Non-owner non-staff gets 404
      const otherAgent = request.agent(app.callback());
      await otherAgent.post("/api/v1/auth/login").send({ username: "coach1", password: "coach12345" });
      const otherRes = await otherAgent.get(`/api/v1/orders/${orderId}`);
      expect(otherRes.status).toBe(404);

      // Support staff CAN access
      const supportAgent = request.agent(app.callback());
      await supportAgent.post("/api/v1/auth/login").send({ username: "support1", password: "support12345" });
      const supportRes = await supportAgent.get(`/api/v1/orders/${orderId}`);
      expect(supportRes.status).toBe(200);
    } finally {
      if (orderId) {
        await connection.query("DELETE FROM orders WHERE id = ?", [orderId]);
      }
      if (courseId) {
        await connection.query("DELETE FROM courses_services WHERE id = ?", [courseId]);
      }
      connection.release();
    }
  }, 20000);
});
