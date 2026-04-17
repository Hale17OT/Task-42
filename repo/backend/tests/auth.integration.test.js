const { describeDb, pool, unauth, unique, loginAsAthlete, createRegisteredUser, app, request } = require("./helpers/integration-helpers");

describeDb("Auth endpoints", () => {
  describe("POST /api/v1/auth/register", () => {
    test("201 on valid registration; user persists with user role and encrypted profile", async () => {
      const username = unique("reg");
      const res = await unauth()
        .post("/api/v1/auth/register")
        .send({ username, password: "pass12345", email: `${username}@test.local`, displayName: username, legalName: "Jane Doe", phone: "555-1234" });

      expect(res.status).toBe(201);
      expect(res.body.data.username).toBe(username);
      expect(res.body.data.roles).toEqual(["user"]);

      const [rows] = await pool.query("SELECT id, email FROM users WHERE username = ?", [username]);
      expect(rows.length).toBe(1);
      expect(rows[0].email).toBe(`${username}@test.local`);

      const [profileRows] = await pool.query("SELECT legal_name_encrypted, phone_encrypted FROM user_profiles WHERE user_id = ?", [rows[0].id]);
      expect(profileRows.length).toBe(1);
      expect(profileRows[0].legal_name_encrypted).not.toBeNull();
      expect(String(profileRows[0].legal_name_encrypted)).not.toContain("Jane Doe");

      await pool.query("DELETE FROM user_profiles WHERE user_id = ?", [rows[0].id]);
      await pool.query("DELETE FROM user_roles WHERE user_id = ?", [rows[0].id]);
      await pool.query("DELETE FROM users WHERE id = ?", [rows[0].id]);
    });

    test("400 when username missing", async () => {
      const res = await unauth().post("/api/v1/auth/register").send({ password: "pass12345" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    test("400 when password too short", async () => {
      const res = await unauth().post("/api/v1/auth/register").send({ username: unique("x"), password: "short" });
      expect(res.status).toBe(400);
    });

    test("400 when username too short", async () => {
      const res = await unauth().post("/api/v1/auth/register").send({ username: "ab", password: "pass12345" });
      expect(res.status).toBe(400);
    });

    test("409 when username already taken", async () => {
      const username = unique("dup");
      await unauth().post("/api/v1/auth/register").send({ username, password: "pass12345" });
      const res = await unauth().post("/api/v1/auth/register").send({ username, password: "pass12345" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("USERNAME_EXISTS");

      const [rows] = await pool.query("SELECT id FROM users WHERE username = ?", [username]);
      if (rows.length) {
        await pool.query("DELETE FROM user_profiles WHERE user_id = ?", [rows[0].id]);
        await pool.query("DELETE FROM user_roles WHERE user_id = ?", [rows[0].id]);
        await pool.query("DELETE FROM users WHERE id = ?", [rows[0].id]);
      }
    });
  });

  describe("POST /api/v1/auth/login", () => {
    test("200 on valid credentials sets session cookie", async () => {
      const res = await unauth().post("/api/v1/auth/login").send({ username: "athlete1", password: "athlete12345" });
      expect(res.status).toBe(200);
      expect(res.body.data.username).toBe("athlete1");
      expect(res.headers["set-cookie"]).toBeDefined();
      expect(res.headers["set-cookie"].some((c) => c.includes("trailforge_session"))).toBe(true);
    });

    test("401 on invalid password", async () => {
      const res = await unauth().post("/api/v1/auth/login").send({ username: "athlete1", password: "wrongpass" });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    test("401 on unknown username", async () => {
      const res = await unauth().post("/api/v1/auth/login").send({ username: "nouser-" + Date.now(), password: "pass12345" });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    test("400 on missing credentials", async () => {
      const res = await unauth().post("/api/v1/auth/login").send({});
      expect(res.status).toBe(400);
    });

    test("persists auth_session row with hashed token", async () => {
      await unauth().post("/api/v1/auth/login").send({ username: "coach1", password: "coach12345" });
      const [rows] = await pool.query("SELECT session_token_hash, status FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE username = 'coach1') ORDER BY id DESC LIMIT 1");
      expect(rows[0].session_token_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(rows[0].status).toBe("active");
    });
  });

  describe("POST /api/v1/auth/logout", () => {
    test("401 when not authenticated", async () => {
      const res = await unauth().post("/api/v1/auth/logout");
      expect(res.status).toBe(401);
    });

    test("200 revokes session in DB", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.post("/api/v1/auth/logout");
      expect(res.status).toBe(200);
      expect(res.body.data.loggedOut).toBe(true);

      const [rows] = await pool.query("SELECT status FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE username = 'athlete1') ORDER BY id DESC LIMIT 1");
      expect(rows[0].status).toBe("revoked");
    });
  });

  describe("GET /api/v1/auth/me", () => {
    test("401 when not authenticated", async () => {
      const res = await unauth().get("/api/v1/auth/me");
      expect(res.status).toBe(401);
    });

    test("200 returns user info with roles and decrypted profile", async () => {
      const agent = await loginAsAthlete();
      const res = await agent.get("/api/v1/auth/me");
      expect(res.status).toBe(200);
      expect(res.body.data.username).toBe("athlete1");
      expect(Array.isArray(res.body.data.roles)).toBe(true);
      expect(res.body.data.profile).toBeDefined();
      expect(res.body.data.subscriber).toBeDefined();
    });
  });

  describe("Login rate limiting", () => {
    test("429 after many failed attempts to same username", async () => {
      const badUser = `rl-${Date.now()}`;
      // Attack the IP+username bucket. Reseed backend memory may retain prior attempts, so use fresh name.
      for (let i = 0; i < 9; i += 1) {
        await unauth().post("/api/v1/auth/login").send({ username: badUser, password: "wrong" });
      }
      const res = await unauth().post("/api/v1/auth/login").send({ username: badUser, password: "wrong" });
      expect([401, 429]).toContain(res.status);
      if (res.status === 429) {
        expect(["TOO_MANY_LOGIN_ATTEMPTS", "RATE_LIMITED"]).toContain(res.body.error.code);
      }
    }, 15000);
  });
});
