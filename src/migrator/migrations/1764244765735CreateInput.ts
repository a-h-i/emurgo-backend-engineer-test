import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>) {
    const query = sql`
create table input(
    transaction_id text references transactions(id) on delete cascade on update cascade not null,
    index integer not null,
    output_reference_index integer not null,
    output_reference_transaction_id text references transactions(id) on delete cascade on update cascade not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key(transaction_id, index)
);
create trigger set_timestamps_input before insert or update on input for each row execute procedure set_timestamps();
`
    await query.execute(db);
}

export async function down(db: Kysely<unknown>) {
    const query = sql`
drop table input;
`;
    await query.execute(db);
}