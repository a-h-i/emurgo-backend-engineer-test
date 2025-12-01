// spec/ingestBlock.spec.ts
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { sql } from "kysely";
import { createDB } from "../src/db";
import { ingestBlock } from "../src/control/ingestBlock";
import type { Block as BlockSchemaType } from "../src/control/Block.schema";

const db = createDB();

// ---- shared test data ----

const validBlock: BlockSchemaType = {
  id: "block-new",
  height: 2,
  transactions: [
    {
      id: "tx-new-1",
      inputs: [],
      outputs: [
        { address: "addr1", value: 100 },
        { address: "addr2", value: 50 },
      ],
    },
    {
      id: "tx-new-2",
      inputs: [
        {
          txId: "tx-seed",
          index: 0,
        },
      ],
      outputs: [
        { address: "addr3", value: 60 },
        { address: "addr4", value: 40 },
      ],
    },
  ],
};

// ---- mock validator / side‑effect functions ----

const validHeightMock = mock<
  (block: BlockSchemaType, trx: unknown) => Promise<boolean>
>(async () => true);

const validBlockIdMock = mock<(block: BlockSchemaType) => boolean>(() => true);

const outputsAndInputsMatchingMock = mock<
  (block: BlockSchemaType, trx: unknown) => Promise<boolean>
>(async () => true);

const applyBalancesMock = mock<
  (trx: unknown, tx: BlockSchemaType["transactions"][number]) => Promise<void>
>(async () => {});

// ---- db cleanup ----

afterAll(async () => {
  await sql`
    truncate table block cascade;
    truncate table output cascade;
    truncate table input cascade;
    truncate table transactions cascade;
    truncate table address cascade;
  `.execute(db);
});

beforeEach(async () => {
  await sql`
    truncate table block cascade;
    truncate table output cascade;
    truncate table input cascade;
    truncate table transactions cascade;
    truncate table address cascade;
  `.execute(db);

  // seed a previous block / tx so that references in validBlock make sense
  await db
    .insertInto("block")
    .values({ id: "block-seed", height: 1 })
    .execute();
  await db
    .insertInto("transactions")
    .values({ id: "tx-seed", block_id: "block-seed" })
    .execute();
  await db
    .insertInto("address")
    .values({ id: "addr-seed", balance: 100 })
    .execute();
  await db
    .insertInto("output")
    .values({
      transaction_id: "tx-seed",
      address_id: "addr-seed",
      value: 100,
      index: 0,
    })
    .execute();

  validHeightMock.mockReset();
  validBlockIdMock.mockReset();
  outputsAndInputsMatchingMock.mockReset();
  applyBalancesMock.mockReset();
});

describe("ingestBlock", () => {
  test("returns 400 and does not insert when height is invalid", async () => {
    validHeightMock.mockResolvedValueOnce(false);

    const result = await ingestBlock(
      validBlock,
      validHeightMock,
      validBlockIdMock,
      outputsAndInputsMatchingMock,
      applyBalancesMock,
    );

    expect(result).toEqual({
      message: "Block height is invalid",
      status: 400,
    });

    // validate that height validation was called with correct params
    expect(validHeightMock.mock.calls.length).toBe(1);
    const heightCall = validHeightMock.mock.calls[0];
    expect(heightCall[0]).toEqual(validBlock);
    expect(heightCall[1]).toBeDefined();

    // other validators and applyBalances are not called
    expect(validBlockIdMock.mock.calls.length).toBe(0);
    expect(outputsAndInputsMatchingMock.mock.calls.length).toBe(0);
    expect(applyBalancesMock.mock.calls.length).toBe(0);

    // no new block with id "block-new" was inserted
    const blocks = await db
      .selectFrom("block")
      .selectAll()
      .where("id", "=", validBlock.id)
      .execute();
    expect(blocks.length).toBe(0);
  });

  test("returns 400 and does not insert when block id is invalid", async () => {
    validHeightMock.mockResolvedValueOnce(true);
    validBlockIdMock.mockReturnValueOnce(false);

    const result = await ingestBlock(
      validBlock,
      validHeightMock,
      validBlockIdMock,
      outputsAndInputsMatchingMock,
      applyBalancesMock,
    );

    expect(result).toEqual({
      message: "Invalid block id",
      status: 400,
    });

    expect(validHeightMock.mock.calls.length).toBe(1);
    expect(validHeightMock.mock.calls[0][0]).toEqual(validBlock);

    expect(validBlockIdMock.mock.calls.length).toBe(1);
    expect(validBlockIdMock.mock.calls[0][0]).toEqual(validBlock);

    // outputs/inputs validation and applyBalances are not called
    expect(outputsAndInputsMatchingMock.mock.calls.length).toBe(0);
    expect(applyBalancesMock.mock.calls.length).toBe(0);

    const blocks = await db
      .selectFrom("block")
      .selectAll()
      .where("id", "=", validBlock.id)
      .execute();
    expect(blocks.length).toBe(0);
  });

  test("returns 400 and does not insert when outputs and inputs do not match", async () => {
    validHeightMock.mockResolvedValueOnce(true);
    validBlockIdMock.mockReturnValueOnce(true);
    outputsAndInputsMatchingMock.mockResolvedValueOnce(false);

    const result = await ingestBlock(
      validBlock,
      validHeightMock,
      validBlockIdMock,
      outputsAndInputsMatchingMock,
      applyBalancesMock,
    );

    expect(result).toEqual({
      message: "Outputs and inputs do not match",
      status: 400,
    });

    expect(validHeightMock.mock.calls.length).toBe(1);
    expect(validHeightMock.mock.calls[0][0]).toEqual(validBlock);

    expect(validBlockIdMock.mock.calls.length).toBe(1);
    expect(validBlockIdMock.mock.calls[0][0]).toEqual(validBlock);

    expect(outputsAndInputsMatchingMock.mock.calls.length).toBe(1);
    const outputsCall = outputsAndInputsMatchingMock.mock.calls[0];
    expect(outputsCall[0]).toEqual(validBlock);
    expect(outputsCall[1]).toBeDefined();

    // applyBalances is not called
    expect(applyBalancesMock.mock.calls.length).toBe(0);

    const blocks = await db
      .selectFrom("block")
      .selectAll()
      .where("id", "=", validBlock.id)
      .execute();
    expect(blocks.length).toBe(0);
  });

  test("inserts block, transactions, inputs, outputs and calls applyBalances on success", async () => {
    validHeightMock.mockResolvedValueOnce(true);
    validBlockIdMock.mockReturnValueOnce(true);
    outputsAndInputsMatchingMock.mockResolvedValueOnce(true);

    const result = await ingestBlock(
      validBlock,
      validHeightMock,
      validBlockIdMock,
      outputsAndInputsMatchingMock,
      applyBalancesMock,
    );

    expect(result).toEqual({
      message: "Block ingested successfully",
      status: 201,
    });

    // block insertion (only the new block)
    const blocks = await db
      .selectFrom("block")
      .selectAll()
      .where("id", "=", validBlock.id)
      .execute();
    expect(blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "block-new", height: "2" }),
      ]),
    );

    // transactions insertion for the new block
    const txs = await db
      .selectFrom("transactions")
      .select(["id", "block_id"])
      .where("block_id", "=", validBlock.id)
      .orderBy("id")
      .execute();
    expect(txs).toEqual([
      { id: "tx-new-1", block_id: "block-new" },
      { id: "tx-new-2", block_id: "block-new" },
    ]);

    // inputs insertion
    const inputs = await db
      .selectFrom("input")
      .select([
        "transaction_id",
        "index",
        "output_reference_transaction_id",
        "output_reference_index",
      ])
      .orderBy("transaction_id")
      .orderBy("index")
      .execute();
    expect(inputs).toEqual([
      {
        transaction_id: "tx-new-2",
        index: 0,
        output_reference_transaction_id: "tx-seed",
        output_reference_index: 0,
      },
    ]);

    // outputs insertion for new txs
    const outputs = await db
      .selectFrom("output")
      .select(["transaction_id", "address_id", "index", "value"])
      .where("transaction_id", "in", ["tx-new-1", "tx-new-2"])
      .orderBy("transaction_id")
      .orderBy("index")
      .execute();
    expect(outputs).toEqual([
      {
        transaction_id: "tx-new-1",
        address_id: "addr1",
        index: 0,
        value: "100",
      },
      {
        transaction_id: "tx-new-1",
        address_id: "addr2",
        index: 1,
        value: "50",
      },
      {
        transaction_id: "tx-new-2",
        address_id: "addr3",
        index: 0,
        value: "60",
      },
      {
        transaction_id: "tx-new-2",
        address_id: "addr4",
        index: 1,
        value: "40",
      },
    ]);

    // validators called with correct params
    expect(validHeightMock.mock.calls.length).toBe(1);
    expect(validHeightMock.mock.calls[0][0]).toEqual(validBlock);

    expect(validBlockIdMock.mock.calls.length).toBe(1);
    expect(validBlockIdMock.mock.calls[0][0]).toEqual(validBlock);

    expect(outputsAndInputsMatchingMock.mock.calls.length).toBe(1);
    expect(outputsAndInputsMatchingMock.mock.calls[0][0]).toEqual(validBlock);

    // applyBalances called once per transaction with (trx, tx)
    expect(applyBalancesMock.mock.calls.length).toBe(
      validBlock.transactions.length,
    );
    validBlock.transactions.forEach((tx, i) => {
      const call = applyBalancesMock.mock.calls[i];
      expect(call[0]).toBeDefined(); // trx
      expect(call[1]).toEqual(tx); // original tx payload
    });
  });
});
