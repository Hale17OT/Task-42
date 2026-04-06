const { pool } = require("../src/db/pool");

const moderationPath = require.resolve("../src/modules/reviews/moderation.service");
delete require.cache[moderationPath];
const { checkSensitiveWords } = require("../src/modules/reviews/moderation.service");

describe("Sensitive-word client response sanitization", () => {
  afterAll(() => {
    delete require.cache[moderationPath];
  });

  test("error carries no details at all", async () => {
    pool.query = vi.fn(async () => [[{ word: "forbidden" }, { word: "banned" }]]);

    try {
      await checkSensitiveWords("This text contains the forbidden and banned words");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error.status).toBe(400);
      expect(error.code).toBe("SENSITIVE_WORD_DETECTED");
      expect(error.message).toBe("Content contains restricted words");

      // No details at all — no matched words, no count, nothing
      expect(error.details).toBeNull();

      // Verify the stringified error does not leak the word list
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain("forbidden");
      expect(serialized).not.toContain("banned");
    }
  });

  test("no error thrown when no sensitive words match", async () => {
    pool.query = vi.fn(async () => [[{ word: "forbidden" }]]);

    await expect(checkSensitiveWords("This is clean text")).resolves.toBeUndefined();
  });
});
