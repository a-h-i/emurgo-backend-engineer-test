import { Hono } from "hono";
import { createDB } from "./db";
export const app = new Hono();

app.get("/balance/:address", async (c) => {
  const address = c.req.param("address");
  const db = createDB();
  const account = await db
    .selectFrom("address")
    .select("balance")
    .where("id", "=", address)
    .executeTakeFirst();

  if (!account) {
    return c.json({ error: "Address not found" }, 404);
  }
  return c.json({ balance: account.balance });
});
