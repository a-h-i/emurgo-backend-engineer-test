import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>) {
  const query = sql`
create function set_timestamps() returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;
`;
  await query.execute(db);
}

export async function down(db: Kysely<unknown>) {
  const query = sql`
drop function set_timestamps();
`;
  await query.execute(db);
}
