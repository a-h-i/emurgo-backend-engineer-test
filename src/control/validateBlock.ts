import type { Block } from "./Block.schema.ts";
import { createHash } from "node:crypto";
import { sql, Transaction } from "kysely";
import type { DB } from "../db";

export function isValidBlockId(block: Block) {
  const transactionIds = block.transactions.reduce((acc, tx) => {
    return acc + tx.id;
  }, "");

  const hash = createHash("sha256").update(transactionIds).digest("hex"); // assuming hex encoding
  return hash === block.id;
}

export async function isValidHeight(block: Block, trx: Transaction<DB>) {
  const result = await trx
    .selectFrom("block")
    .select((eb) => {
      return eb.fn
        .coalesce((eb) => eb.fn.max<bigint>("height"), sql`0`)
        .as("maxHeight");
    })
    .executeTakeFirstOrThrow();
  return BigInt(block.height) === BigInt(result.maxHeight) + BigInt(1);
}

export async function areOutputsAndInputsMatching(
  block: Block,
  trx: Transaction<DB>,
) {
  if (block.height === 1) {
    // pass for seed block
    return true;
  }

  for (const tx of block.transactions) {
    // first we need to get the matching outputs for each input
    const matchingOutputs = await trx
      .selectFrom("output")
      .select("value")
      .where(({ eb, refTuple, tuple }) =>
        eb(
          refTuple("transaction_id", "index"),
          "in",
          tx.inputs.map((input) => tuple(input.txId, input.index)),
        ),
      )
      .execute();

    const matchingOutputsSum = matchingOutputs
      .map((output) => BigInt(output.value))
      .reduce((acc, value) => acc + value, BigInt(0));
    const outputsSum = tx.outputs
      .map((output) => BigInt(output.value))
      .reduce((acc, value) => acc + value, BigInt(0));
    if (outputsSum !== matchingOutputsSum) {
      return false;
    }
  }
  return true;
}
