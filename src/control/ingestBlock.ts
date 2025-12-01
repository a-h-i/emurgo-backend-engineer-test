import { type Block as BlockSchemaType } from "./Block.schema.ts";
import type {
  areOutputsAndInputsMatching,
  isValidBlockId,
  isValidHeight,
} from "./validateBlock.ts";
import type { applyBalances } from "./applyBalances.ts";
import { type Address, createDB, type Input, type Output } from "../db";
import type { Insertable } from "kysely";

export async function ingestBlock(
  data: BlockSchemaType,
  validateHeightFn: typeof isValidHeight,
  validateBlockIdFn: typeof isValidBlockId,
  validateOutputsFn: typeof areOutputsAndInputsMatching,
  applyBalancesFn: typeof applyBalances,
): Promise<{
  message: string;
  status: 201 | 400;
}> {
  const db = createDB();
  return await db
    .transaction()
    .setIsolationLevel("serializable")
    .execute(async (trx) => {
      const validHeight = await validateHeightFn(data, trx);
      if (!validHeight) {
        return {
          message: "Block height is invalid",
          status: 400,
        };
      }
      const validBlockId = validateBlockIdFn(data);
      if (!validBlockId) {
        return {
          message: "Invalid block id",
          status: 400,
        };
      }
      const validInputs = await validateOutputsFn(data, trx);
      if (!validInputs) {
        return {
          message: "Outputs and inputs do not match",
          status: 400,
        };
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

      const addresses: Insertable<Address>[] = outputs.map((output) => {
        return {
          id: output.address_id,
          balance: 0,
        };
      });
      await trx
        .insertInto("address")
        .onConflict((eb) => eb.column("id").doNothing())
        .values(addresses)
        .execute();

      await trx.insertInto("output").values(outputs).execute();
      for (const tx of data.transactions) {
        await applyBalancesFn(trx, tx);
      }
      return {
        message: "Block ingested successfully",
        status: 201,
      };
    });
}
