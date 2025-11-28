import assert from 'node:assert';
import {Kysely, PostgresDialect} from "kysely";
import type {DB} from "./schema";
import {Pool} from "pg";


let db: Kysely<DB> | undefined;

export function createDB() {
    const dbUrl = process.env.DATABASE_URL;
    assert(dbUrl, 'DATABASE_URL environment variable must be set');
    if (db) {
        return db;
    }
    db = new Kysely<DB>({
        dialect: new PostgresDialect({
            pool: new Pool({
                connectionString: dbUrl,
                max: parseInt(process.env.DB_POOL_MAX_SIZE ?? '10')
            })
        })
    })
    return db;
}