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

// Note: When using serializable isolation level, the db will throw a serialization error if two transactions try to update the same row at the same time.
// This is because the isolation level is set to serializable by default.
// This can be handled in many different ways
// to name a few
// we can retry the transaction at the api level with backoff and debouncing
// or we can have whoever is calling the api (assuming some sort of ingest job/queue from a node's data) do the retrying themselves.
// I felt this was out of scope for this exercise.

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
