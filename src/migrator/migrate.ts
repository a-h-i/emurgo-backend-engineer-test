import { Pool } from 'pg';
import path from 'node:path';
import assert from 'node:assert';

import {
    Migrator,
    FileMigrationProvider,
    Kysely,
    PostgresDialect,
} from 'kysely';
import fs from 'node:fs/promises';


export async function migrate() {
    const dbUrl = process.env.DATABASE_URL;
    assert(dbUrl, 'DATABASE_URL environment variable must be set');
    const db = new Kysely({
        dialect: new PostgresDialect({
            pool: new Pool({
                connectionString: dbUrl,
            }),
        }),
    });
    try {
        const migrator = new Migrator({
            db,
            provider: new FileMigrationProvider({
                fs,
                path,
                migrationFolder: path.join(__dirname, 'migrations'),
            }),
        });
        const { error, results } = await migrator.migrateToLatest();
        results?.forEach((result) => {
            if (result.status === 'Success') {
                console.log(
                    `migration "${result.migrationName}" was executed successfully`,
                );
            } else if (result.status === 'Error') {
                console.error(`failed to execute migration "${result.migrationName}"`);
            }
        });
        if (error) {
            console.error('Migrations failed');
            console.error(error);
            throw new Error('Migrations failed');
        }
        console.log('Migrations completed successfully');
    } finally {
        await db.destroy();
    }
}

migrate().catch((err) => {
    console.error(err);
    process.exit(1);
});