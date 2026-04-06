const { pool } = require("../../db/pool");
const ApiError = require("../../errors/api-error");
const { ensureUserNotBlacklisted, checkSensitiveWords, enforceDailyPublishCap } = require("./moderation.service");
const { flagSharedDeviceRisk, refreshGovernanceAnalyticsSnapshot } = require("./risk.service");
const { withTransaction, writeReviewAudit } = require("./reviews.shared");

async function persistDimensionScores(connection, reviewId, dimensionScores) {
  for (const dimension of dimensionScores) {
    const [dimensionRows] = await connection.query("SELECT id FROM review_dimension_configs WHERE id = ? AND is_active = 1 LIMIT 1", [
      dimension.dimensionConfigId
    ]);
    if (!dimensionRows.length) {
      throw new ApiError(400, "INVALID_DIMENSION", `Dimension ${dimension.dimensionConfigId} is not active`);
    }

    await connection.query(
      `
        INSERT INTO review_dimension_scores (review_id, dimension_config_id, score)
        VALUES (?, ?, ?)
      `,
      [reviewId, dimension.dimensionConfigId, dimension.score]
    );
  }
}

async function createReview({ userId, payload, requestId }) {
  await ensureUserNotBlacklisted(userId);
  await checkSensitiveWords(payload.reviewText);

  const reviewId = await withTransaction(pool, async (connection) => {
    await enforceDailyPublishCap(userId, connection);

    const [orderRows] = await connection.query(
      `
        SELECT id, order_status
        FROM orders
        WHERE id = ? AND user_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [payload.orderId, userId]
    );

    if (!orderRows.length) {
      throw new ApiError(404, "ORDER_NOT_FOUND", "Order not found for user");
    }
    if (orderRows[0].order_status !== "completed") {
      throw new ApiError(400, "ORDER_NOT_COMPLETED", "Only completed orders can be reviewed");
    }

    const [existingRows] = await connection.query("SELECT id FROM reviews WHERE order_id = ? AND user_id = ? LIMIT 1", [
      payload.orderId,
      userId
    ]);
    if (existingRows.length) {
      throw new ApiError(409, "REVIEW_ALREADY_EXISTS", "One primary review per order is allowed");
    }

    const [insert] = await connection.query(
      `
        INSERT INTO reviews (order_id, user_id, rating, review_state, anonymous_display, review_text, published_at)
        VALUES (?, ?, ?, 'published', ?, ?, CURRENT_TIMESTAMP)
      `,
      [payload.orderId, userId, payload.rating, payload.anonymousDisplay ? 1 : 0, payload.reviewText]
    );

    await persistDimensionScores(connection, insert.insertId, payload.dimensionScores);

    await connection.query(
      `
        INSERT INTO moderation_events (review_id, actor_user_id, event_type, decision, notes)
        VALUES (?, ?, 'review_publish', 'allow', 'Passed baseline moderation checks')
      `,
      [insert.insertId, userId]
    );

    return insert.insertId;
  });

  await flagSharedDeviceRisk(userId);
  await refreshGovernanceAnalyticsSnapshot();
  await writeReviewAudit({
    actorUserId: userId,
    eventType: "review.created",
    entityType: "review",
    entityId: String(reviewId),
    requestId,
    payload: { orderId: payload.orderId }
  });

  const [rows] = await pool.query("SELECT * FROM reviews WHERE id = ? LIMIT 1", [reviewId]);
  return rows[0];
}

module.exports = {
  createReview
};
