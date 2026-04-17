// Probe MySQL reachability. Exit 0 if reachable, 1 otherwise.
const mysql = require("mysql2/promise");

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || "trailforge",
      password: process.env.DB_PASSWORD || "trailforge",
      database: process.env.DB_NAME || "trailforge",
      connectTimeout: 1500
    });
    await conn.query("SELECT 1");
    await conn.end();
    process.exit(0);
  } catch {
    process.exit(1);
  }
})();
