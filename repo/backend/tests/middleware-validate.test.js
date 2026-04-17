const { z } = require("zod");
const validate = require("../src/middleware/validate");

describe("middleware/validate — pure unit", () => {
  test("passes through valid body and calls next", async () => {
    const schema = z.object({ name: z.string().min(1) });
    const ctx = { request: { body: { name: "ok" } } };
    let nextCalled = false;
    const next = async () => { nextCalled = true; };

    await validate({ body: schema })(ctx, next);
    expect(nextCalled).toBe(true);
    expect(ctx.request.body.name).toBe("ok");
  });

  test("throws VALIDATION_ERROR for invalid body", async () => {
    const schema = z.object({ name: z.string().min(5) });
    const ctx = { request: { body: { name: "ab" } } };
    const next = async () => {};

    await expect(validate({ body: schema })(ctx, next)).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid request body"
    });
  });

  test("coerces query params when schema allows coercion", async () => {
    const schema = z.object({ limit: z.coerce.number().int().positive() });
    const ctx = { request: { query: { limit: "42" } } };
    let nextCalled = false;
    const next = async () => { nextCalled = true; };

    await validate({ query: schema })(ctx, next);
    expect(ctx.request.query.limit).toBe(42);
    expect(nextCalled).toBe(true);
  });

  test("throws VALIDATION_ERROR for invalid query", async () => {
    const schema = z.object({ limit: z.coerce.number().int().positive() });
    const ctx = { request: { query: { limit: "notanumber" } } };
    await expect(validate({ query: schema })(ctx, async () => {})).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid query parameters"
    });
  });

  test("coerces path params and calls next", async () => {
    const schema = z.object({ id: z.coerce.number().int().positive() });
    const ctx = { params: { id: "7" } };
    await validate({ params: schema })(ctx, async () => {});
    expect(ctx.params.id).toBe(7);
  });

  test("throws VALIDATION_ERROR for invalid path params", async () => {
    const schema = z.object({ id: z.coerce.number().int().positive() });
    const ctx = { params: { id: "abc" } };
    await expect(validate({ params: schema })(ctx, async () => {})).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid path parameters"
    });
  });

  test("handles missing query/params gracefully", async () => {
    const schema = z.object({ limit: z.coerce.number().optional() });
    const ctx = { request: {} };
    let nextCalled = false;
    await validate({ query: schema })(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  test("applies body, query, and params together", async () => {
    const bodySchema = z.object({ a: z.string() });
    const querySchema = z.object({ b: z.coerce.number() });
    const paramsSchema = z.object({ c: z.coerce.number() });
    const ctx = {
      request: { body: { a: "x" }, query: { b: "2" } },
      params: { c: "3" }
    };
    await validate({ body: bodySchema, query: querySchema, params: paramsSchema })(ctx, async () => {});
    expect(ctx.request.body.a).toBe("x");
    expect(ctx.request.query.b).toBe(2);
    expect(ctx.params.c).toBe(3);
  });
});
