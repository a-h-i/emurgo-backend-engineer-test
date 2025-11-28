import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>) {
  const query = sql`
create table output(
    transaction_id text references transactions(id) on delete cascade on update cascade not null,
    index integer not null,
    address_id text not null references address(id) on delete cascade on update cascade not null,
    value numeric not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key(transaction_id, index)
);
create trigger set_timestamps_output before insert or update on output for each row execute procedure set_timestamps();
`;
  await query.execute(db);
}

export async function down(db: Kysely<unknown>) {
  const query = sql`
drop table output;
`;
  await query.execute(db);
}
