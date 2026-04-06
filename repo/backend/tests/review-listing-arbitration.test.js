const { pool } = require("../src/db/pool");

const reviewsReadPath = require.resolve("../src/modules/reviews/reviews.read.service");
delete require.cache[reviewsReadPath];

const { listUserReviews, getReviewDetail } = require("../src/modules/reviews/reviews.read.service");

describe("Under-arbitration review masking", () => {
  afterAll(() => {
    delete require.cache[reviewsReadPath];
  });

  test("listUserReviews masks review_text for under_arbitration reviews", async () => {
    pool.query = vi.fn(async (sql) => {
      if (sql.includes("FROM reviews r") && sql.includes("JOIN orders o")) {
        return [[
          {
            id: 1,
            order_id: 10,
            rating: 5,
            review_state: "published",
            anonymous_display: 0,
            review_text: "Great service!",
            published_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            order_status: "completed"
          },
          {
            id: 2,
            order_id: 11,
            rating: 3,
            review_state: "under_arbitration",
            anonymous_display: 0,
            review_text: "This is disputed content",
            published_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            order_status: "completed"
          }
        ]];
      }
      // Images and followups
      if (sql.includes("FROM review_images") || sql.includes("FROM review_followups")) {
        return [[]];
      }
      return [[]];
    });

    const results = await listUserReviews(42);

    expect(results).toHaveLength(2);

    // Published review shows actual text
    expect(results[0].review_text).toBe("Great service!");

    // Under-arbitration review masks text
    expect(results[1].review_text).toBe("Content hidden during arbitration");
    expect(results[1].image_count).toBe(0);
    expect(results[1].followup).toBeNull();
  });
});

describe("Appeal eligibility alignment", () => {
  test("canAppeal is true when previous appeal is upheld/rejected within 7 days", async () => {
    const authzPath = require.resolve("../src/modules/reviews/reviews.authorization");
    const originalAuth = require("../src/modules/reviews/reviews.authorization");

    pool.query = vi.fn(async (sql) => {
      if (sql.includes("FROM reviews r") && sql.includes("WHERE r.id = ?")) {
        return [[{
          id: 5,
          order_id: 1,
          user_id: 42,
          rating: 4,
          review_state: "hidden",
          anonymous_display: 0,
          review_text: "my review",
          published_at: new Date().toISOString(),
          username: "user42",
          display_name: "User"
        }]];
      }
      if (sql.includes("FROM review_dimension_scores")) return [[]];
      if (sql.includes("FROM review_images")) return [[]];
      if (sql.includes("FROM review_followups")) return [[]];
      if (sql.includes("FROM review_replies")) return [[]];
      if (sql.includes("FROM appeals")) {
        return [[{
          id: 100,
          review_id: 5,
          appeal_status: "upheld",
          submitted_at: new Date().toISOString(),
          resolved_at: new Date().toISOString()
        }]];
      }
      if (sql.includes("FROM appeal_timeline_events")) return [[]];
      return [[]];
    });

    const detail = await getReviewDetail({
      reviewId: 5,
      requester: { id: 42, roles: ["user"] }
    });

    // With the fix, upheld appeal should allow re-appeal within window
    expect(detail.canAppeal).toBe(true);
  });

  test("canAppeal is false when appeal is submitted (open)", async () => {
    pool.query = vi.fn(async (sql) => {
      if (sql.includes("FROM reviews r") && sql.includes("WHERE r.id = ?")) {
        return [[{
          id: 6,
          order_id: 2,
          user_id: 42,
          rating: 3,
          review_state: "under_arbitration",
          anonymous_display: 0,
          review_text: "another review",
          published_at: new Date().toISOString(),
          username: "user42",
          display_name: "User"
        }]];
      }
      if (sql.includes("FROM review_dimension_scores")) return [[]];
      if (sql.includes("FROM review_images")) return [[]];
      if (sql.includes("FROM review_followups")) return [[]];
      if (sql.includes("FROM review_replies")) return [[]];
      if (sql.includes("FROM appeals")) {
        return [[{
          id: 101,
          review_id: 6,
          appeal_status: "submitted",
          submitted_at: new Date().toISOString(),
          resolved_at: null
        }]];
      }
      if (sql.includes("FROM appeal_timeline_events")) return [[]];
      return [[]];
    });

    const detail = await getReviewDetail({
      reviewId: 6,
      requester: { id: 42, roles: ["user"] }
    });

    expect(detail.canAppeal).toBe(false);
  });
});
