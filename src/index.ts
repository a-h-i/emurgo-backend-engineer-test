import { Hono } from "hono";
import { createDB, type Input, type Output } from "./db";
import { zValidator } from "@hono/zod-validator";
import {
  applyBalances,
  areOutputsAndInputsMatching,
  BlockSchema,
  isValidBlockId,
  isValidHeight,
} from "./control";
import type { Insertable } from "kysely";
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
  const db = createDB();
  return await db
    .transaction()
    .setIsolationLevel("serializable")
    .execute(async (trx) => {
      const validHeight = await isValidHeight(data, trx);
      if (!validHeight) {
        return c.json({ error: "Invalid block height" }, 400);
      }
      const validBlockId = isValidBlockId(data);
      if (!validBlockId) {
        return c.json({ error: "Invalid block id" }, 400);
      }
      const validInputs = await areOutputsAndInputsMatching(data, trx);
      if (!validInputs) {
        return c.json({ error: "Outputs and inputs do not match" }, 400);
      }

      await trx
        .insertInto("block")
        .values({
          id: data.id,
          height: data.height,
        })
        .execute();
      await trx
        .insertInto("transactions")
        .values(
          data.transactions.map((tx) => ({
            block_id: data.id,
            id: tx.id,
          })),
        )
        .execute();
      type InputValueType = Insertable<Input>;
      const inputs = data.transactions.reduce((acc, tx) => {
        const mappedInputs: InputValueType[] = tx.inputs.map(
          (input, index) => ({
            transaction_id: tx.id,
            index,
            output_reference_index: input.index,
            output_reference_transaction_id: input.txId,
          }),
        );
        return acc.concat(mappedInputs);
      }, [] as InputValueType[]);
      await trx.insertInto("input").values(inputs).execute();
      type OutputValueType = Insertable<Output>;
      const outputs = data.transactions.reduce((acc, tx) => {
        const mappedOutputs: OutputValueType[] = tx.outputs.map(
          (output, index) => ({
            transaction_id: tx.id,
            address_id: output.address,
            index,
            value: output.value,
          }),
        );
        return acc.concat(mappedOutputs);
      }, [] as OutputValueType[]);
      await trx.insertInto("output").values(outputs).execute();
      for (const tx of data.transactions) {
        await applyBalances(trx, tx);
      }
      return c.json({ message: "Block ingested successfully" }, 201);
    });
});

export default app;
