import { createDB } from "../db";
import { sql } from "kysely";

export async function rollbackLatest() {
  const db = createDB();
  const trx = db.transaction().setIsolationLevel("serializable");

  await trx.execute(async (trx) => {
    const block = await trx
      .selectFrom("block")
      .selectAll()
      .orderBy("height", "desc")
      .limit(1)
      .executeTakeFirstOrThrow();

    const transactionsRaw = await trx
      .selectFrom("transactions")
      .where("transactions.block_id", "=", block.id)
      .selectAll()
      .execute();

    if (transactionsRaw.length == 0) {
      await trx.deleteFrom("block").where("id", "=", block.id).execute();
      return;
    }
    const inputs = await trx
      .selectFrom("input")
      .where(
        "transaction_id",
        "in",
        transactionsRaw.map((transaction) => transaction.id),
      )
      .orderBy("transaction_id", "asc")
      .orderBy("index", "asc")
      .selectAll()
      .execute();
    const outputs = await trx
      .selectFrom("output")
      .where(
        "transaction_id",
        "in",
        transactionsRaw.map((transaction) => transaction.id),
      )
      .orderBy("transaction_id", "asc")
      .orderBy("index", "asc")
      .selectAll()
      .execute();

    // first we roll back the outputs.
    for (const output of outputs) {
      await trx
        .updateTable("address")
        .where("id", "=", output.address_id)
        .set({ balance: sql`balance - ${output.value}` })
        .execute();
    }
    // now we credit back the inputs.
    for (const input of inputs) {
      const referenceOutput = await trx
        .selectFrom("output")
        .where("transaction_id", "=", input.output_reference_transaction_id)
        .where("index", "=", input.output_reference_index)
        .select(["value", "address_id"])
        .executeTakeFirstOrThrow();
      await trx
        .updateTable("address")
        .where("id", "=", referenceOutput.address_id)
        .set({ balance: sql`balance + ${referenceOutput.value}` })
        .execute();
    }
    await trx.deleteFrom("block").where("id", "=", block.id).execute(); // cascades.
  });
}
