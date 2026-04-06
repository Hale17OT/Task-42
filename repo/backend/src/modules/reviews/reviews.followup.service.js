const { pool } = require("../../db/pool");
const ApiError = require("../../errors/api-error");
const { ensureUserNotBlacklisted, checkSensitiveWords, enforceDailyPublishCap } = require("./moderation.service");
const { canCreateFollowup } = require("./review.rules");
const { withTransaction, writeReviewAudit } = require("./reviews.shared");

async function addFollowup({ userId, reviewId, followupText, requestId }) {
  await ensureUserNotBlacklisted(userId);
  await checkSensitiveWords(followupText);

  const followupId = await withTransaction(pool, async (connection) => {
    await enforceDailyPublishCap(userId, connection);

    const [reviewRows] = await connection.query("SELECT * FROM reviews WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE", [reviewId, userId]);
    if (!reviewRows.length) {
      throw new ApiError(404, "REVIEW_NOT_FOUND", "Review not found for user");
    }

    const review = reviewRows[0];
    if (!canCreateFollowup(review.published_at)) {
      throw new ApiError(400, "FOLLOWUP_WINDOW_EXPIRED", "Follow-up review is only allowed within 30 days");
    }

    const [existingRows] = await connection.query("SELECT id FROM review_followups WHERE review_id = ? LIMIT 1", [reviewId]);
    if (existingRows.length) {
      throw new ApiError(409, "FOLLOWUP_ALREADY_EXISTS", "Only one follow-up review is allowed");
    }

    const [insert] = await connection.query(
      `
        INSERT INTO review_followups (review_id, user_id, followup_text)
        VALUES (?, ?, ?)
      `,
      [reviewId, userId, followupText]
    );

    return insert.insertId;
  });

  await writeReviewAudit({
    actorUserId: userId,
    eventType: "review.followup.created",
    entityType: "review_followup",
    entityId: String(followupId),
    requestId,
    payload: { reviewId }
  });

  const [rows] = await pool.query("SELECT * FROM review_followups WHERE id = ? LIMIT 1", [followupId]);
  return rows[0];
}

module.exports = {
  addFollowup
};
