import { Hono } from "hono";
import { createDB } from "./db";
import { zValidator } from "@hono/zod-validator";
import {
  applyBalances,
  areOutputsAndInputsMatching,
  BlockSchema,
  isValidBlockId,
  isValidHeight,
} from "./control";
import { ingestBlock } from "./control/ingestBlock.ts";
const app = new Hono();

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

app.post("/blocks", zValidator("json", BlockSchema), async (c) => {
  const data = c.req.valid("json");
  const result = await ingestBlock(
    data,
    isValidHeight,
    isValidBlockId,
    areOutputsAndInputsMatching,
    applyBalances,
  );
  return c.json(result, result.status);
});

export default app;
