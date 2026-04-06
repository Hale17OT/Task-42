const { pool } = require("../../db/pool");
const ApiError = require("../../errors/api-error");
const { writeAuditEvent } = require("../../services/audit-log");
const { normalizeArray, scoreFeedCandidate, dedupeCandidates } = require("./feed.logic");
const { listFollowedAuthorIds } = require("../follows/follows.service");

async function ensureUserPreferences(userId) {
  const [rows] = await pool.query("SELECT * FROM user_feed_preferences WHERE user_id = ? LIMIT 1", [userId]);
  if (rows.length) {
    return rows[0];
  }

  await pool.query(
    `
      INSERT INTO user_feed_preferences (
        user_id,
        preferred_sports,
        blocked_tags,
        blocked_authors,
        include_training_updates,
        include_course_updates,
        include_news
      )
      VALUES (?, '[]', '[]', '[]', 1, 1, 1)
    `,
    [userId]
  );

  const [created] = await pool.query("SELECT * FROM user_feed_preferences WHERE user_id = ? LIMIT 1", [userId]);
  return created[0];
}

function similarityKeyForActivity(activity) {
  const distance = Number(activity.distance_miles || 0).toFixed(1);
  const day = new Date(activity.created_at).toISOString().slice(0, 10);
  return `activity:${activity.activity_type}:${distance}:${day}`;
}

function similarityKeyForCourseUpdate(order) {
  const day = new Date(order.updated_at || order.created_at).toISOString().slice(0, 10);
  return `course:${order.course_service_id}:${order.order_status}:${day}`;
}

function similarityKeyForNews(item) {
  return `news:${item.content_hash}`;
}

async function loadBrowsingSignals(userId) {
  const [rows] = await pool.query(
    `
      SELECT i.tag_list_json
      FROM feed_impression_history h
      JOIN ingested_content_items i ON i.id = h.content_item_id
      WHERE h.user_id = ?
        AND h.action_taken = 'clicked'
      ORDER BY h.id DESC
      LIMIT 100
    `,
    [userId]
  );

  const counts = new Map();
  for (const row of rows) {
    const tags = normalizeArray(row.tag_list_json);
    for (const tag of tags) {
      const key = String(tag).toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map((entry) => entry[0]);
}

async function getRecentExclusionSignals(userId) {
  const [rows] = await pool.query(
    `
      SELECT similarity_key, content_item_id
      FROM feed_impression_history
      WHERE user_id = ?
        AND impressed_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)
        AND (similarity_key IS NOT NULL OR content_item_id IS NOT NULL)
    `,
    [userId]
  );

  const similarityKeys = new Set();
  const contentItemIds = new Set();

  for (const row of rows) {
    if (row.similarity_key) {
      similarityKeys.add(row.similarity_key);
    }
    if (row.content_item_id) {
      contentItemIds.add(Number(row.content_item_id));
    }
  }

  return { similarityKeys, contentItemIds };
}

function blockedSetFromJson(raw) {
  return new Set(normalizeArray(raw).map((item) => String(item).toLowerCase()));
}

async function fetchActivityCandidates(userId, includeOwn = true) {
  const [rows] = await pool.query(
    `
      SELECT a.id, a.user_id, a.activity_type, a.distance_miles, a.duration_seconds, a.notes, a.created_at, u.username
      FROM activities a
      JOIN users u ON u.id = a.user_id
      WHERE a.status = 'published'
      ORDER BY a.created_at DESC
      LIMIT 200
    `
  );

  return rows
    .filter((row) => includeOwn || row.user_id !== userId)
    .map((row) => ({
      type: "activity",
      id: row.id,
      author: row.username,
      authorUserId: row.user_id,
      title: `${row.activity_type} activity`,
      summary: `${row.distance_miles} miles in ${row.duration_seconds} seconds`,
      tags: [row.activity_type],
      publishedAt: row.created_at,
      similarityKey: similarityKeyForActivity(row),
      payload: {
        distanceMiles: row.distance_miles,
        durationSeconds: row.duration_seconds,
        notes: row.notes
      }
    }));
}

async function fetchCourseUpdateCandidates(userId) {
  const [rows] = await pool.query(
    `
      SELECT o.id, o.order_status, o.updated_at, o.created_at, c.title
      FROM orders o
      JOIN courses_services c ON c.id = o.course_service_id
      WHERE o.user_id = ?
      ORDER BY o.updated_at DESC
      LIMIT 200
    `,
    [userId]
  );

  return rows.map((row) => ({
    type: "course_update",
    id: row.id,
    author: "system",
    authorUserId: null,
    title: row.title,
    summary: `Course status: ${row.order_status}`,
    tags: ["course", "service"],
    publishedAt: row.updated_at || row.created_at,
    similarityKey: similarityKeyForCourseUpdate(row),
    payload: {
      orderStatus: row.order_status
    }
  }));
}

async function fetchNewsCandidates(userId) {
  const [rows] = await pool.query(
    `
      SELECT id, title, author_name, tag_list_json, summary, published_at, content_hash
      FROM ingested_content_items
      WHERE ingestion_status = 'published'
        AND NOT EXISTS (
          SELECT 1
          FROM feed_impression_history h
          WHERE h.user_id = ?
            AND h.content_item_id = ingested_content_items.id
            AND h.impressed_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)
        )
      ORDER BY published_at DESC, id DESC
      LIMIT 300
    `,
    [userId]
  );

  return rows.map((row) => ({
    type: "news",
    id: row.id,
      author: row.author_name || "unknown",
      authorUserId: null,
    title: row.title,
    summary: row.summary,
    tags: normalizeArray(row.tag_list_json),
    publishedAt: row.published_at,
    similarityKey: similarityKeyForNews(row),
    payload: {
      contentItemId: row.id
    }
  }));
}

async function getPersonalizedFeed({ userId, limit = 20 }) {
  const preferences = await ensureUserPreferences(userId);
  const preferredSports = normalizeArray(preferences.preferred_sports).map((item) => String(item).toLowerCase());
  const blockedTags = blockedSetFromJson(preferences.blocked_tags);
  const blockedAuthors = blockedSetFromJson(preferences.blocked_authors);

  const [userRows] = await pool.query("SELECT created_at FROM users WHERE id = ? LIMIT 1", [userId]);
  const [impressionCountRows] = await pool.query("SELECT COUNT(*) AS total FROM feed_impression_history WHERE user_id = ?", [userId]);
  const accountCreatedAt = userRows[0]?.created_at ? new Date(userRows[0].created_at) : new Date();
  const isFirstWeek = Date.now() - accountCreatedAt.getTime() <= 7 * 24 * 60 * 60 * 1000;
  const isColdStart = isFirstWeek && Number(impressionCountRows[0]?.total || 0) < 20;

  const browsingSignals = await loadBrowsingSignals(userId);
  const seenSignals = await getRecentExclusionSignals(userId);
  const followedAuthorIds = await listFollowedAuthorIds(userId);

  const [activityCandidates, courseCandidates, newsCandidates] = await Promise.all([
    preferences.include_training_updates ? fetchActivityCandidates(userId, true) : Promise.resolve([]),
    preferences.include_course_updates ? fetchCourseUpdateCandidates(userId) : Promise.resolve([]),
    preferences.include_news ? fetchNewsCandidates(userId) : Promise.resolve([])
  ]);

  const combined = [...activityCandidates, ...courseCandidates, ...newsCandidates].filter((item) => {
    if (blockedAuthors.has(String(item.author || "").toLowerCase())) {
      return false;
    }

    const tagMatch = (item.tags || []).some((tag) => blockedTags.has(String(tag).toLowerCase()));
    return !tagMatch;
  });

  const deduped = dedupeCandidates(combined, seenSignals);
  const ranked = deduped.map((item) => ({
    ...item,
    score: scoreFeedCandidate(item, {
      preferredSports,
      browsingSignals,
      coldStart: isColdStart,
      followedAuthorIdsSet: new Set(followedAuthorIds)
    })
  }));

  const scored = ranked;

  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, limit);

  for (const item of selected) {
    await pool.query(
      `
        INSERT INTO feed_impression_history (user_id, content_item_id, source_kind, action_taken, similarity_key)
        VALUES (?, ?, ?, 'shown', ?)
      `,
      [userId, item.type === "news" ? item.id : null, item.type, item.similarityKey]
    );
  }

  return selected;
}

async function recordFeedAction({ userId, action, itemType, similarityKey, contentItemId = null, author = null, tag = null, requestId = null }) {
  const prefs = await ensureUserPreferences(userId);
  const blockedAuthors = normalizeArray(prefs.blocked_authors);
  const blockedTags = normalizeArray(prefs.blocked_tags);

  if (action === "block_author" && author) {
    if (!blockedAuthors.includes(author)) {
      blockedAuthors.push(author);
    }
    await pool.query("UPDATE user_feed_preferences SET blocked_authors = ? WHERE user_id = ?", [JSON.stringify(blockedAuthors), userId]);
  }

  if (action === "block_tag" && tag) {
    if (!blockedTags.includes(tag)) {
      blockedTags.push(tag);
    }
    await pool.query("UPDATE user_feed_preferences SET blocked_tags = ? WHERE user_id = ?", [JSON.stringify(blockedTags), userId]);
  }

  await pool.query(
    `
      INSERT INTO feed_impression_history (user_id, content_item_id, source_kind, action_taken, similarity_key)
      VALUES (?, ?, ?, ?, ?)
    `,
    [userId, contentItemId, itemType, action, similarityKey]
  );

  await writeAuditEvent({
    actorUserId: userId,
    eventType: `feed.action.${action}`,
    entityType: "feed_item",
    entityId: similarityKey,
    requestId,
    payload: { itemType, contentItemId, author, tag }
  });

  return { accepted: true };
}

async function getFeedPreferences(userId) {
  const prefs = await ensureUserPreferences(userId);
  return {
    preferredSports: normalizeArray(prefs.preferred_sports),
    blockedTags: normalizeArray(prefs.blocked_tags),
    blockedAuthors: normalizeArray(prefs.blocked_authors),
    includeTrainingUpdates: Boolean(prefs.include_training_updates),
    includeCourseUpdates: Boolean(prefs.include_course_updates),
    includeNews: Boolean(prefs.include_news)
  };
}

async function updateFeedPreferences({ userId, payload, requestId }) {
  const existing = await ensureUserPreferences(userId);
  const preferredSports = payload.preferredSports || normalizeArray(existing.preferred_sports);

  await pool.query(
    `
      UPDATE user_feed_preferences
      SET preferred_sports = ?,
          include_training_updates = ?,
          include_course_updates = ?,
          include_news = ?
      WHERE user_id = ?
    `,
    [
      JSON.stringify(preferredSports),
      payload.includeTrainingUpdates ? 1 : 0,
      payload.includeCourseUpdates ? 1 : 0,
      payload.includeNews ? 1 : 0,
      userId
    ]
  );

  await writeAuditEvent({
    actorUserId: userId,
    eventType: "feed.preferences.updated",
    entityType: "user_feed_preferences",
    entityId: String(userId),
    requestId,
    payload: { preferredSports }
  });

  return getFeedPreferences(userId);
}

module.exports = {
  getPersonalizedFeed,
  recordFeedAction,
  getFeedPreferences,
  updateFeedPreferences
};
