// spec/rollbackLatest.spec.ts
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";
import { createDB } from "../src/db";
import {
  applyBalances,
  type Transaction as BlockTransaction,
  rollbackLatest,
} from "../src/control";

const db = createDB();

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
});

describe("rollbackLatest", () => {
  test("throws when there are no blocks", async () => {
    await expect(rollbackLatest()).rejects.toThrow();
  });

  test("removes latest block that has no transactions and leaves balances untouched", async () => {
    // seed: two blocks, but only the first has a transaction that created a balance
    await db.insertInto("block").values({ id: "block1", height: 1 }).execute();
    await db.insertInto("block").values({ id: "block2", height: 2 }).execute();

    const tx1: BlockTransaction = {
      id: "tx1",
      inputs: [],
      outputs: [{ address: "addr1", value: 50 }],
    };

    await db
      .insertInto("transactions")
      .values({ id: tx1.id, block_id: "block1" })
      .execute();

    await db
      .insertInto("address")
      .values({ id: "addr1", balance: 0 })
      .execute();
    await db
      .insertInto("output")
      .values({
        transaction_id: tx1.id,
        address_id: "addr1",
        value: 50,
        index: 0,
      })
      .execute();

    await db.transaction().execute(async (trx) => {
      await applyBalances(trx, tx1);
    });

    const beforeRollbackAddr = await db
      .selectFrom("address")
      .select(["id", "balance"])
      .execute();
    expect(beforeRollbackAddr).toEqual([{ id: "addr1", balance: "50" }]);

    // rollback latest (block2, which has no transactions)
    await rollbackLatest();

    // latest block (block2) is gone, block1 remains
    const blocks = await db
      .selectFrom("block")
      .selectAll()
      .orderBy("height")
      .execute();
    expect(blocks).toHaveLength(1);
    expect(blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "block1", height: "1" }),
      ]),
    );

    // balances are unchanged
    const afterRollbackAddr = await db
      .selectFrom("address")
      .select(["id", "balance"])
      .execute();
    expect(afterRollbackAddr).toEqual(beforeRollbackAddr);

    // transaction and output of block1 are still there
    const txs = await db.selectFrom("transactions").selectAll().execute();
    expect(txs).toEqual([
      expect.objectContaining({ id: "tx1", block_id: "block1" }),
    ]);
    const outs = await db.selectFrom("output").selectAll().execute();
    expect(outs).toEqual([
      expect.objectContaining({
        transaction_id: "tx1",
        address_id: "addr1",
        value: "50",
        index: 0,
      }),
    ]);
  });

  test("rolls back balances and deletes latest block with transactions", async () => {
    // Seed block1: tx1 -> addrA: 100
    await db.insertInto("block").values({ id: "block1", height: 1 }).execute();
    await db
      .insertInto("address")
      .values([
        { id: "addrA", balance: 0 },
        { id: "addrB", balance: 0 },
        { id: "addrC", balance: 0 },
      ])
      .execute();

    const tx1: BlockTransaction = {
      id: "tx1",
      inputs: [],
      outputs: [{ address: "addrA", value: 100 }],
    };

    await db
      .insertInto("transactions")
      .values({ id: tx1.id, block_id: "block1" })
      .execute();

    await db
      .insertInto("output")
      .values({
        transaction_id: tx1.id,
        address_id: "addrA",
        value: 100,
        index: 0,
      })
      .execute();

    await db.transaction().execute(async (trx) => {
      await applyBalances(trx, tx1);
    });

    // Seed block2: tx2 spends tx1:0, sending 40 to addrB, 60 to addrC
    await db.insertInto("block").values({ id: "block2", height: 2 }).execute();

    const tx2: BlockTransaction = {
      id: "tx2",
      inputs: [{ txId: "tx1", index: 0 }],
      outputs: [
        { address: "addrB", value: 40 },
        { address: "addrC", value: 60 },
      ],
    };

    await db
      .insertInto("transactions")
      .values({ id: tx2.id, block_id: "block2" })
      .execute();

    await db
      .insertInto("input")
      .values({
        transaction_id: tx2.id,
        index: 0,
        output_reference_transaction_id: "tx1",
        output_reference_index: 0,
      })
      .execute();

    await db
      .insertInto("output")
      .values([
        {
          transaction_id: tx2.id,
          address_id: "addrB",
          value: 40,
          index: 0,
        },
        {
          transaction_id: tx2.id,
          address_id: "addrC",
          value: 60,
          index: 1,
        },
      ])
      .execute();

    await db.transaction().execute(async (trx) => {
      await applyBalances(trx, tx2);
    });

    // Sanity check balances before rollback:
    // addrA: 0 (100 spent), addrB: 40, addrC: 60
    const balancesBefore = await db
      .selectFrom("address")
      .select(["id", "balance"])
      .orderBy("id")
      .execute();
    expect(balancesBefore).toEqual([
      { id: "addrA", balance: "0" },
      { id: "addrB", balance: "40" },
      { id: "addrC", balance: "60" },
    ]);

    // Perform rollback of latest block (block2)
    await rollbackLatest();

    // After rollback:
    // - outputs of tx2 are reversed: addrB: -40, addrC: -60 => back to 0
    // - inputs referencing tx1:0 are credited back: addrA +100
    const balancesAfter = await db
      .selectFrom("address")
      .select(["id", "balance"])
      .orderBy("id")
      .execute();
    expect(balancesAfter).toEqual([
      { id: "addrA", balance: "100" },
      { id: "addrB", balance: "0" },
      { id: "addrC", balance: "0" },
    ]);

    // Only block1 remains
    const blocks = await db
      .selectFrom("block")
      .selectAll()
      .orderBy("height")
      .execute();
    expect(blocks).toEqual([
      expect.objectContaining({ id: "block1", height: "1" }),
    ]);

    // tx2 and its inputs/outputs are gone; tx1 and its output remain
    const txs = await db
      .selectFrom("transactions")
      .selectAll()
      .orderBy("id")
      .execute();
    expect(txs).toEqual([
      expect.objectContaining({ id: "tx1", block_id: "block1" }),
    ]);

    const inputs = await db.selectFrom("input").selectAll().execute();
    expect(inputs).toEqual([]);

    const outputs = await db
      .selectFrom("output")
      .selectAll()
      .orderBy("transaction_id")
      .orderBy("index")
      .execute();
    expect(outputs).toEqual([
      expect.objectContaining({
        transaction_id: "tx1",
        address_id: "addrA",
        value: "100",
        index: 0,
      }),
    ]);
  });
});
