import { Hono } from "hono";
import { createDB } from "./db";
import { zValidator } from "@hono/zod-validator";
import {
  applyBalances,
  areOutputsAndInputsMatching,
  BlockSchema,
  isValidBlockId,
  isValidHeight,
  ingestBlock,
  rollbackLatest,
} from "./control";
import { z } from "zod";
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

const RollbackSchema = z.object({
  height: z.number().min(1).max(2000),
});

app.post("/rollback", zValidator("query", RollbackSchema), async (c) => {
  const requestedHeight = c.req.valid("query").height;
  for (let i = requestedHeight; i > 0; i--) {
    await rollbackLatest();
  }
  return c.json({
    message: `Rollback to height ${requestedHeight} successful`,
  });
});

export default app;
