import { expect, test, beforeEach, afterAll } from "bun:test";
import { createDB } from "../src/db";
import { sql } from "kysely";
import { app } from "../src";

afterAll(async () => {
  const db = createDB();
  await sql`
            truncate table address cascade;
        `.execute(db);
});
beforeEach(async () => {
  const db = createDB();
  await sql`truncate table address cascade`.execute(db);
});

test("404 on unknown address", async () => {
  const response = await app.request("/balance/2134f");
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    error: "Address not found",
  });
});

test("200 on known address", async () => {
  const db = createDB();
  await db
    .insertInto("address")
    .values([
      { id: "1234", balance: 100 },
      { id: "5555", balance: 20 },
    ])
    .execute();
  const response = await app.request("/balance/1234");
  expect(response.status).toBe(200);
  const json = (await response.json()) as Record<string, unknown>;
  expect(json).toEqual({ balance: "100" });
});
