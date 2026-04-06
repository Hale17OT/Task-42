const { spawnSync } = require("child_process");
const mysql = require("mysql2/promise");

const vitestBin = require.resolve("vitest/vitest.mjs");

async function assertDbReachable() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "trailforge",
    password: process.env.DB_PASSWORD || "trailforge",
    database: process.env.DB_NAME || "trailforge",
    connectTimeout: 2000
  });

  try {
    await connection.query("SELECT 1");
  } finally {
    await connection.end();
  }
}

async function run() {
  try {
    await assertDbReachable();
  } catch {
    process.stderr.write(
      "DB integration tests require a reachable MySQL instance with backend migrations and seeds applied.\n"
    );
    process.stderr.write(
      "Verify DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME and run migrations/seeds before retrying.\n"
    );
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [vitestBin, "run", "tests/*.integration.test.js"], {
    stdio: "inherit",
    env: {
      ...process.env,
      RUN_DB_TESTS: "1"
    }
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status || 0);
}

run().catch((error) => {
  process.stderr.write(`${error?.message || "Unexpected integration test runner failure"}\n`);
  process.exit(1);
});
