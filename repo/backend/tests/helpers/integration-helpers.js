const request = require("supertest");
const app = require("../../src/app");
const { pool } = require("../../src/db/pool");
const { loginRateLimit } = require("../../src/middleware/auth-rate-limit");

// Reset rate limiter before every test file loads to prevent cross-file carry-over.
if (typeof loginRateLimit.reset === "function") {
  loginRateLimit.reset();
}

// Auto-detect DB reachability so integration suites run by default whenever
// MySQL is reachable. No env var required. The suites skip cleanly (describe.skip)
// if the DB is unavailable, allowing unit-only test runs to still succeed.
function probeDbSync() {
  const { execFileSync } = require("child_process");
  const path = require("path");
  try {
    execFileSync(process.execPath, [path.join(__dirname, "probe-db.js")], {
      stdio: "ignore",
      timeout: 4000,
      env: process.env
    });
    return true;
  } catch {
    return false;
  }
}

const DB_REACHABLE = probeDbSync();
const runDbTests = DB_REACHABLE || process.env.RUN_DB_TESTS === "1";

const describeDb = runDbTests ? describe : describe.skip;

function unique(label) {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

async function loginAs(username, password) {
  // Reset rate limiter to prevent integration-test suite from hitting
  // the IP rate limit window. Tests should validate rate limiting
  // explicitly, not be limited by it.
  if (typeof loginRateLimit.reset === "function") {
    loginRateLimit.reset();
  }
  const agent = request.agent(app.callback());
  const res = await agent.post("/api/v1/auth/login").send({ username, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

async function loginAsAdmin() {
  return loginAs("admin", "admin12345");
}
async function loginAsCoach() {
  return loginAs("coach1", "coach12345");
}
async function loginAsSupport() {
  return loginAs("support1", "support12345");
}
async function loginAsAthlete() {
  return loginAs("athlete1", "athlete12345");
}

async function getUserId(username) {
  const [rows] = await pool.query("SELECT id FROM users WHERE username = ? LIMIT 1", [username]);
  if (!rows.length) throw new Error(`User not found: ${username}`);
  return rows[0].id;
}

async function createRegisteredUser(usernameBase = "user") {
  const username = unique(usernameBase);
  const password = "pass12345";
  const agent = request.agent(app.callback());
  const res = await agent.post("/api/v1/auth/register").send({
    username,
    password,
    email: `${username}@test.local`,
    displayName: username
  });
  if (res.status !== 201) {
    throw new Error(`Register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const loginRes = await agent.post("/api/v1/auth/login").send({ username, password });
  if (loginRes.status !== 200) {
    throw new Error(`Auto-login failed: ${loginRes.status}`);
  }
  return { agent, username, password, userId: res.body.data.id };
}

function unauth() {
  return request(app.callback());
}

function resetLoginRateLimit() {
  if (typeof loginRateLimit.reset === "function") {
    loginRateLimit.reset();
  }
}

module.exports = {
  app,
  pool,
  request,
  runDbTests,
  describeDb,
  unique,
  loginAs,
  loginAsAdmin,
  loginAsCoach,
  loginAsSupport,
  loginAsAthlete,
  createRegisteredUser,
  getUserId,
  unauth,
  resetLoginRateLimit
};
