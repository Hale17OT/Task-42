module.exports = {
  id: "006_daily_review_quota",
  async up(connection) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS daily_review_quota (
        user_id BIGINT UNSIGNED NOT NULL,
        quota_date DATE NOT NULL,
        used_count INT UNSIGNED NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, quota_date),
        CONSTRAINT fk_daily_review_quota_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  },
  async down(connection) {
    await connection.query("DROP TABLE IF EXISTS daily_review_quota");
  }
};
