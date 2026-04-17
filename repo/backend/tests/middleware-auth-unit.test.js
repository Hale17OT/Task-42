// Pure unit tests for requireAuth/requireRole without HTTP and without mocks.
// optionalAuth is covered in integration tests (it requires DB lookup by design).

const { requireAuth, requireRole } = require("../src/middleware/auth");

describe("middleware/auth — requireAuth pure unit", () => {
  test("throws 401 UNAUTHORIZED when ctx.state.user is absent", async () => {
    const ctx = { state: {} };
    await expect(requireAuth(ctx, async () => {})).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED"
    });
  });

  test("throws 401 when ctx.state.user is null", async () => {
    const ctx = { state: { user: null } };
    await expect(requireAuth(ctx, async () => {})).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED"
    });
  });

  test("throws 403 ACCOUNT_DISABLED when user status is not active", async () => {
    const ctx = { state: { user: { id: 1, status: "disabled", roles: ["user"] } } };
    await expect(requireAuth(ctx, async () => {})).rejects.toMatchObject({
      status: 403,
      code: "ACCOUNT_DISABLED"
    });
  });

  test("throws 403 when user status is 'locked'", async () => {
    const ctx = { state: { user: { id: 1, status: "locked", roles: ["user"] } } };
    await expect(requireAuth(ctx, async () => {})).rejects.toMatchObject({
      status: 403,
      code: "ACCOUNT_DISABLED"
    });
  });

  test("calls next when user is active", async () => {
    const ctx = { state: { user: { id: 1, status: "active", roles: ["user"] } } };
    let nextCalled = false;
    await requireAuth(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});

describe("middleware/auth — requireRole pure unit", () => {
  test("throws 401 when user is absent", async () => {
    const ctx = { state: {} };
    await expect(requireRole(["admin"])(ctx, async () => {})).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED"
    });
  });

  test("throws 403 FORBIDDEN when user has no matching role", async () => {
    const ctx = { state: { user: { roles: ["user"] } } };
    await expect(requireRole(["admin"])(ctx, async () => {})).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN"
    });
  });

  test("throws 403 when roles array is empty", async () => {
    const ctx = { state: { user: { roles: [] } } };
    await expect(requireRole(["admin"])(ctx, async () => {})).rejects.toMatchObject({
      status: 403
    });
  });

  test("passes when user has exact matching role", async () => {
    const ctx = { state: { user: { roles: ["admin"] } } };
    let called = false;
    await requireRole(["admin"])(ctx, async () => { called = true; });
    expect(called).toBe(true);
  });

  test("passes when user has any of multiple allowed roles", async () => {
    const ctx = { state: { user: { roles: ["support"] } } };
    let called = false;
    await requireRole(["admin", "support"])(ctx, async () => { called = true; });
    expect(called).toBe(true);
  });

  test("passes when user has multiple roles including one allowed", async () => {
    const ctx = { state: { user: { roles: ["user", "coach"] } } };
    let called = false;
    await requireRole(["coach", "support", "admin"])(ctx, async () => { called = true; });
    expect(called).toBe(true);
  });
});
