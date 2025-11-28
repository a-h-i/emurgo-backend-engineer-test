import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>) {
  const query = sql`

create table transactions(
    id text not null unique,
    block_id text references block(id) on delete cascade on update cascade not null,
    updated_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    primary key(block_id, id)
);
create trigger set_timestamps_transactions before insert or update on transactions for each row execute procedure set_timestamps();
`;
  await query.execute(db);
}

export async function down(db: Kysely<unknown>) {
  const query = sql`
drop table transactions;
`;
  await query.execute(db);
}
