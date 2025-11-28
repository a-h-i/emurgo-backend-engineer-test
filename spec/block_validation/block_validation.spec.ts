import { expect, test, describe, beforeEach, afterAll } from "bun:test";
import { createHash } from "node:crypto";
import {
  areOutputsAndInputsMatching,
  type Block as BlockSchemaType,
  isValidBlockId,
  isValidHeight,
} from "../../src/control";
import { createDB } from "../../src/db";
import { sql } from "kysely";

afterAll(async () => {
  const db = createDB();
  await sql`
            truncate table block cascade;
            truncate table output cascade;
            truncate table input cascade;
            truncate table transactions cascade;
            truncate table address cascade;
        `.execute(db);
});

describe("block id validation", () => {
  test("valid block id", () => {
    const blockId = createHash("sha256").update("tx1tx2tx3").digest("hex");

    const block: BlockSchemaType = {
      id: blockId,
      transactions: [
        {
          id: "tx1",
          inputs: [],
          outputs: [],
        },
        {
          id: "tx2",
          inputs: [],
          outputs: [],
        },
        {
          id: "tx3",
          inputs: [],
          outputs: [],
        },
      ],
      height: 1,
    };
    expect(isValidBlockId(block)).toBe(true);
  });

  test("invalid block id", () => {
    const blockId = createHash("sha256").update("tx1tx2tx3").digest("hex");

    const block: BlockSchemaType = {
      id: blockId,
      transactions: [
        {
          id: "tx1",
          inputs: [],
          outputs: [],
        },
        {
          id: "tx3",
          inputs: [],
          outputs: [],
        },
      ],
      height: 1,
    };
    expect(isValidBlockId(block)).toBe(false);
  });
});

describe("block height validation", () => {
  const db = createDB();

  beforeEach(async () => {
    await sql`truncate table block cascade`.execute(db);
  });

  test("Empty database valid height", async () => {
    const block: BlockSchemaType = {
      id: "block1",
      transactions: [],
      height: 1,
    };
    const isValid = await db
      .transaction()
      .execute((trx) => isValidHeight(block, trx));
    expect(isValid).toBe(true);
  });
  test("Empty database invalid height", async () => {
    const block: BlockSchemaType = {
      id: "block1",
      transactions: [],
      height: 0,
    };
    let isValid = await db
      .transaction()
      .execute((trx) => isValidHeight(block, trx));
    expect(isValid).toBe(false);
    block.height = 2;
    isValid = await db
      .transaction()
      .execute((trx) => isValidHeight(block, trx));
    expect(isValid).toBe(false);
  });

  test("Database with blocks valid height", async () => {
    await db
      .insertInto("block")
      .values([
        { id: "block1", height: 1 },
        { id: "block2", height: 2 },
      ])
      .execute();
    const block: BlockSchemaType = {
      id: "block3",
      transactions: [],
      height: 3,
    };
    const isValid = await db
      .transaction()
      .execute((trx) => isValidHeight(block, trx));
    expect(isValid).toBe(true);
  });

  test("Database with blocks invalid height", async () => {
    await db
      .insertInto("block")
      .values([
        { id: "block1", height: 1 },
        { id: "block2", height: 2 },
      ])
      .execute();
    const block: BlockSchemaType = {
      id: "block3",
      transactions: [],
      height: 4,
    };
    let isValid = await db
      .transaction()
      .execute((trx) => isValidHeight(block, trx));
    expect(isValid).toBe(false);
    block.height = 1;
    isValid = await db
      .transaction()
      .execute((trx) => isValidHeight(block, trx));
    expect(isValid).toBe(false);
  });
});

describe("block outputs and inputs matching", () => {
  const db = createDB();
  beforeEach(async () => {
    await sql`
            truncate table block cascade;
            truncate table output cascade;
            truncate table input cascade;
            truncate table transactions cascade;
            truncate table address cascade;
        `.execute(db);
  });

  test("seed block valid", async () => {
    const block: BlockSchemaType = {
      id: "block1",
      transactions: [
        {
          id: "tx1",
          inputs: [],
          outputs: [
            {
              address: "address1",
              value: 100,
            },
          ],
        },
      ],
      height: 1,
    };
    const isValid = await db
      .transaction()
      .execute((trx) => areOutputsAndInputsMatching(block, trx));
    expect(isValid).toBe(true);
  });

  test("has matching outputs and inputs", async () => {
    await db.insertInto("block").values({ id: "block1", height: 1 }).execute();
    await db
      .insertInto("transactions")
      .values({ id: "tx1", block_id: "block1" })
      .execute();
    await db
      .insertInto("address")
      .values({ id: "address1", balance: 100 })
      .execute();
    await db
      .insertInto("output")
      .values({
        transaction_id: "tx1",
        address_id: "address1",
        value: 100,
        index: 0,
      })
      .execute();
    const block: BlockSchemaType = {
      id: "block2",
      transactions: [
        {
          id: "tx2",
          inputs: [
            {
              txId: "tx1",
              index: 0,
            },
          ],
          outputs: [
            {
              address: "address1",
              value: 10,
            },
          ],
        },
      ],
      height: 2,
    };
    const isValid = await db
      .transaction()
      .execute((trx) => areOutputsAndInputsMatching(block, trx));
    expect(isValid).toBe(true);
  });

  test("input exceeds matching output", async () => {
    await db.insertInto("block").values({ id: "block1", height: 1 }).execute();
    await db
      .insertInto("transactions")
      .values({ id: "tx1", block_id: "block1" })
      .execute();
    await db
      .insertInto("address")
      .values({ id: "address1", balance: 100 })
      .execute();
    await db
      .insertInto("output")
      .values({
        transaction_id: "tx1",
        address_id: "address1",
        value: 100,
        index: 0,
      })
      .execute();
    const block: BlockSchemaType = {
      id: "block2",
      transactions: [
        {
          id: "tx2",
          inputs: [
            {
              txId: "tx1",
              index: 0,
            },
          ],
          outputs: [
            {
              address: "address1",
              value: 101,
            },
          ],
        },
      ],
      height: 2,
    };
    const isValid = await db
      .transaction()
      .execute((trx) => areOutputsAndInputsMatching(block, trx));
    expect(isValid).toBe(false);
  });

  test("has no matching outputs and inputs", async () => {
    const block: BlockSchemaType = {
      id: "block2",
      transactions: [
        {
          id: "tx2",
          inputs: [
            {
              txId: "tx1",
              index: 0,
            },
          ],
          outputs: [
            {
              address: "address1",
              value: 10,
            },
          ],
        },
      ],
      height: 2,
    };
    const isValid = await db
      .transaction()
      .execute((trx) => areOutputsAndInputsMatching(block, trx));
    expect(isValid).toBe(false);
  });
});
