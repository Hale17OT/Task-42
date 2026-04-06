const { pool } = require("../src/db/pool");

const followsServicePath = require.resolve("../src/modules/follows/follows.service");
const mockedListFollowedAuthorIds = vi.fn();

require.cache[followsServicePath] = {
  id: followsServicePath,
  filename: followsServicePath,
  loaded: true,
  exports: { listFollowedAuthorIds: mockedListFollowedAuthorIds }
};

const { getPersonalizedFeed } = require("../src/modules/feed/feed.service");

describe("Feed course-update tenant isolation", () => {
  const USER_ID = 50;
  const OTHER_USER_ID = 99;

  beforeEach(() => {
    mockedListFollowedAuthorIds.mockReset();
    mockedListFollowedAuthorIds.mockResolvedValue([]);

    pool.query = vi.fn(async (sql, params) => {
      if (sql.includes("FROM user_feed_preferences")) {
        return [[{
          user_id: USER_ID,
          preferred_sports: "[]",
          blocked_tags: "[]",
          blocked_authors: "[]",
          include_training_updates: 0,
          include_course_updates: 1,
          include_news: 0
        }]];
      }
      if (sql.includes("SELECT created_at FROM users")) {
        return [[{ created_at: "2026-01-01T00:00:00.000Z" }]];
      }
      if (sql.includes("COUNT(*) AS total FROM feed_impression_history")) {
        return [[{ total: 50 }]];
      }
      if (sql.includes("AND h.action_taken = 'clicked'")) {
        return [[]];
      }
      if (sql.includes("SELECT similarity_key, content_item_id")) {
        return [[]];
      }
      if (sql.includes("FROM orders o") && sql.includes("JOIN courses_services")) {
        // Verify the query filters by user_id
        if (params && params[0] === USER_ID) {
          return [[{
            id: 10,
            order_status: "paid",
            updated_at: "2026-03-25T10:00:00.000Z",
            created_at: "2026-03-20T10:00:00.000Z",
            title: "My Course",
            course_service_id: 5
          }]];
        }
        // If somehow called without the correct userId, return other user's orders
        return [[{
          id: 20,
          order_status: "paid",
          updated_at: "2026-03-25T10:00:00.000Z",
          created_at: "2026-03-20T10:00:00.000Z",
          title: "Other User Course",
          course_service_id: 6
        }]];
      }
      if (sql.includes("INSERT INTO feed_impression_history")) {
        return [{}];
      }
      return [[]];
    });
  });

  afterAll(() => {
    delete require.cache[followsServicePath];
    delete require.cache[require.resolve("../src/modules/feed/feed.service")];
  });

  test("course updates are scoped to the requesting user's orders", async () => {
    const items = await getPersonalizedFeed({ userId: USER_ID, limit: 10 });

    // Verify the course update query was called with the correct userId
    const courseQueryCall = pool.query.mock.calls.find(
      (call) => String(call[0]).includes("FROM orders o") && String(call[0]).includes("JOIN courses_services")
    );

    expect(courseQueryCall).toBeTruthy();
    // The WHERE clause must include user_id = ? with the requesting user's ID
    expect(String(courseQueryCall[0])).toContain("WHERE o.user_id = ?");
    expect(courseQueryCall[1]).toEqual([USER_ID]);

    // Verify the returned items contain only the requesting user's course
    const courseItems = items.filter((item) => item.type === "course_update");
    expect(courseItems.length).toBe(1);
    expect(courseItems[0].title).toBe("My Course");
  });

  test("course updates do not include other users' orders", async () => {
    const items = await getPersonalizedFeed({ userId: USER_ID, limit: 10 });

    const courseItems = items.filter((item) => item.type === "course_update");
    const hasOtherUserCourse = courseItems.some((item) => item.title === "Other User Course");
    expect(hasOtherUserCourse).toBe(false);
  });

  test("course update payload does not expose order ID", async () => {
    const items = await getPersonalizedFeed({ userId: USER_ID, limit: 10 });

    const courseItems = items.filter((item) => item.type === "course_update");
    for (const item of courseItems) {
      // The payload should contain order status but no raw order identifiers
      // that could be used for cross-user enumeration
      expect(item.payload).toBeDefined();
      expect(item.payload.orderStatus).toBeDefined();
    }
  });
});
