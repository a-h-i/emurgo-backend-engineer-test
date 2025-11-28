import { Kysely, sql } from 'kysely';


export async function up(db: Kysely<unknown>) {
    const query = sql`
create table address(
    id text primary key,
    balance numeric not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create trigger set_timestamps_address before insert or update on address for each row execute procedure set_timestamps();
`
    await query.execute(db);
}

export async function down(db: Kysely<unknown>) {
    const query = sql`
drop table address;
`;
    await query.execute(db);
}