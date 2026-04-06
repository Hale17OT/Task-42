module.exports = {
  id: "007_ingestion_moderation_log_type",
  async up(connection) {
    await connection.query(`
      ALTER TABLE immutable_ingestion_logs
      MODIFY COLUMN log_type ENUM('detected', 'parsed', 'filtered', 'stored', 'retried', 'failed', 'moderation_flag') NOT NULL
    `);
  },
  async down(connection) {
    await connection.query(`
      ALTER TABLE immutable_ingestion_logs
      MODIFY COLUMN log_type ENUM('detected', 'parsed', 'filtered', 'stored', 'retried', 'failed') NOT NULL
    `);
  }
};
