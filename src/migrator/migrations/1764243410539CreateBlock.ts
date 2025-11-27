import { Kysely, sql } from 'kysely';


export async function up(db: Kysely<unknown>) {

    const query = sql`
create table block(
    id text primary key,
    height bigint not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create trigger set_timestamps_block before insert or update on block for each row execute procedure set_timestamps();
create unique index block_height_idx on block(height);
`;
    await query.execute(db);
}

export async function down(db: Kysely<unknown>) {
    const query = sql`
drop table block;
`;
    await query.execute(db);
}