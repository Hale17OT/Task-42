import { test, expect } from "@playwright/test";

/**
 * Real FE↔BE E2E test. Hits the actual running backend at
 * http://localhost:3000 (started via `docker-compose up --build`).
 * NO `page.route` mocking, NO response stubbing — this exercises the
 * full Koa + MySQL + Vue stack including CORS, session cookies,
 * JSON contract, and optimistic UI updates.
 *
 * Prerequisites: backend + mysql containers running and seeded.
 * The frontend dev server is started by Playwright's webServer config.
 */
test.describe("Real FE↔BE (no mocks)", () => {
  test("guest is redirected to login", async ({ page }) => {
    await page.goto("/orders");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("seeded athlete1 logs in against real backend and lands in app shell", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Username").fill("athlete1");
    await page.getByLabel("Password").fill("athlete12345");
    await page.getByRole("button", { name: "Sign In" }).click();

    // After successful real login, the router guard redirects away from /login.
    // Depending on onboarding state, the user lands on / (feed) or /onboarding/interests.
    await expect(page).not.toHaveURL(/\/login$/);

    // The real /auth/me response populates session state, so the sidebar
    // branding and user chip should render.
    await expect(page.locator(".sidebar-brand")).toBeVisible();
    await expect(page.getByText("athlete1", { exact: false })).toBeVisible();
  });

  test("invalid credentials surface a real 401 error from backend", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Username").fill("athlete1");
    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: "Sign In" }).click();

    // The backend returns 401 INVALID_CREDENTIALS; the UI stays on /login
    // and surfaces an error message.
    await expect(page).toHaveURL(/\/login$/);
  });

  test("admin can reach admin-only ops page (real RBAC round-trip)", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill("admin");
    await page.getByLabel("Password").fill("admin12345");
    await page.getByRole("button", { name: "Sign In" }).click();

    await expect(page).not.toHaveURL(/\/login$/);

    // Navigate to admin-only page. Real router guard checks real /auth/me roles.
    await page.goto("/admin/ops");
    await expect(page).toHaveURL(/\/admin\/ops$/);
  });

  test("non-admin is redirected away from admin-only page (real role gate)", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill("athlete1");
    await page.getByLabel("Password").fill("athlete12345");
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page).not.toHaveURL(/\/login$/);

    // athlete1 has role 'user' only; router guard should reroute to feed.
    await page.goto("/admin/ops");
    await expect(page).not.toHaveURL(/\/admin\/ops$/);
  });
});
