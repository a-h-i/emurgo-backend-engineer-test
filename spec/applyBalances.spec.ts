import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { sql } from "kysely";
import { createDB } from "../src/db";
import {
  applyBalances,
  type Transaction as BlockTransaction,
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

describe("applyBalances", () => {
  beforeEach(async () => {
    await sql`
      truncate table block cascade;
      truncate table output cascade;
      truncate table input cascade;
      truncate table transactions cascade;
      truncate table address cascade;
    `.execute(db);
  });

  test("creates balances for a seed transaction with only outputs", async () => {
    const tx: BlockTransaction = {
      id: "tx-seed",
      inputs: [],
      outputs: [
        { address: "addr1", value: 100 },
        { address: "addr2", value: 50 },
      ],
    };

    await db.transaction().execute(async (trx) => {
      await applyBalances(trx, tx);
    });

    const balances = await db
      .selectFrom("address")
      .select(["id", "balance"])
      .orderBy("id")
      .execute();

    expect(balances).toEqual([
      { id: "addr1", balance: "100" },
      { id: "addr2", balance: "50" },
    ]);
  });

  test("spends an existing output and updates balances of sender and receivers", async () => {
    // Seed previous UTXO: tx-prev -> addr1: 100
    await db.insertInto("block").values({ id: "block1", height: 1 }).execute();
    await db
      .insertInto("transactions")
      .values({ id: "tx-prev", block_id: "block1" })
      .execute();
    await db
      .insertInto("address")
      .values({ id: "addr1", balance: 100 })
      .execute();
    await db
      .insertInto("output")
      .values({
        transaction_id: "tx-prev",
        address_id: "addr1",
        value: 100,
        index: 0,
      })
      .execute();

    const spendingTx: BlockTransaction = {
      id: "tx-spend",
      inputs: [
        {
          txId: "tx-prev",
          index: 0,
        },
      ],
      outputs: [
        { address: "addr1", value: 40 }, // change back to addr1
        { address: "addr2", value: 60 }, // new receiver
      ],
    };

    await db.transaction().execute(async (trx) => {
      await applyBalances(trx, spendingTx);
    });

    const addr1 = await db
      .selectFrom("address")
      .select(["id", "balance"])
      .where("id", "=", "addr1")
      .executeTakeFirstOrThrow();

    const addr2 = await db
      .selectFrom("address")
      .select(["id", "balance"])
      .where("id", "=", "addr2")
      .executeTakeFirstOrThrow();

    // addr1: 100 - 100 (spent) + 40 (output) = 40
    expect(addr1.balance).toBe("40");
    // addr2: 0 + 60 (new output) = 60
    expect(addr2.balance).toBe("60");
  });

  test("handles multiple inputs and outputs across addresses", async () => {
    // Seed two previous UTXOs:
    // tx1 -> addrA: 70
    // tx2 -> addrB: 30
    await db.insertInto("block").values({ id: "block1", height: 1 }).execute();
    await db
      .insertInto("transactions")
      .values([
        { id: "tx1", block_id: "block1" },
        { id: "tx2", block_id: "block1" },
      ])
      .execute();

    await db
      .insertInto("address")
      .values([
        { id: "addrA", balance: 70 },
        { id: "addrB", balance: 30 },
      ])
      .execute();

    await db
      .insertInto("output")
      .values([
        {
          transaction_id: "tx1",
          address_id: "addrA",
          value: 70,
          index: 0,
        },
        {
          transaction_id: "tx2",
          address_id: "addrB",
          value: 30,
          index: 0,
        },
      ])
      .execute();

    const tx: BlockTransaction = {
      id: "tx-multi",
      inputs: [
        { txId: "tx1", index: 0 },
        { txId: "tx2", index: 0 },
      ],
      outputs: [
        { address: "addrA", value: 50 }, // addrA gets change
        { address: "addrC", value: 50 }, // new address
      ],
    };

    await db.transaction().execute(async (trx) => {
      await applyBalances(trx, tx);
    });

    const balances = await db
      .selectFrom("address")
      .select(["id", "balance"])
      .where("id", "in", ["addrA", "addrB", "addrC"])
      .orderBy("id")
      .execute();

    // addrA: 70 - 70 (spent) + 50 (output) = 50
    // addrB: 30 - 30 (spent) = 0
    // addrC: 0 + 50 (new output) = 50
    expect(balances).toEqual([
      { id: "addrA", balance: "50" },
      { id: "addrB", balance: "0" },
      { id: "addrC", balance: "50" },
    ]);
  });

  test("when there are no matching inputs, existing balances are unchanged and outputs are credited", async () => {
    await db
      .insertInto("address")
      .values({ id: "addr1", balance: 100 })
      .execute();

    const tx: BlockTransaction = {
      id: "tx-nomatch",
      inputs: [
        {
          txId: "non-existent-tx",
          index: 0,
        },
      ],
      outputs: [
        {
          address: "addr1",
          value: 20,
        },
      ],
    };

    await db.transaction().execute(async (trx) => {
      await applyBalances(trx, tx);
    });

    const addr1 = await db
      .selectFrom("address")
      .select(["id", "balance"])
      .where("id", "=", "addr1")
      .executeTakeFirstOrThrow();

    // No matching outputs to spend -> no decrement
    // One output of 20 to addr1 -> increment only
    expect(addr1.balance).toBe("120");
  });
});
