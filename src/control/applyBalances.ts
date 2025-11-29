import { type Insertable, sql, type Transaction } from "kysely";
import type { Address, DB } from "../db";
import type { Transaction as BlockTransaction } from "./Block.schema";

async function decrementBalances(
  dbTrx: Transaction<DB>,
  blkTrx: BlockTransaction,
) {
  // get related outputs
  const matchingOutputs = await dbTrx
    .selectFrom("output")
    .select(["value", "index", "transaction_id", "address_id"])
    .where(({ eb, refTuple, tuple }) =>
      eb(
        refTuple("transaction_id", "index"),
        "in",
        blkTrx.inputs.map((input) => tuple(input.txId, input.index)),
      ),
    )
    .execute();
  // decrement balances that are being spent
  for (const output of matchingOutputs) {
    await dbTrx
      .updateTable("address")
      .where("id", "=", output.address_id)
      .set({
        balance: sql`balance - ${output.value}`,
      })
      .execute();
  }
}

async function incrementBalances(
  dbTrx: Transaction<DB>,
  blkTrx: BlockTransaction,
) {
  // increment or create new balances that are being received
  const receivingBalances: Insertable<Address>[] = blkTrx.outputs.map(
    (input) => ({
      id: input.address,
      balance: input.value,
    }),
  );
  await dbTrx
    .insertInto("address")
    .values(receivingBalances)
    .onConflict((oc) =>
      oc.column("id").doUpdateSet({
        balance: sql`address.balance + excluded.balance`,
      }),
    )
    .execute();
}

export async function applyBalances(
  dbTrx: Transaction<DB>,
  blkTrx: BlockTransaction,
) {
  if (blkTrx.inputs.length > 0) {
    await decrementBalances(dbTrx, blkTrx);
  }
  if (blkTrx.outputs.length > 0) {
    await incrementBalances(dbTrx, blkTrx);
  }
}
