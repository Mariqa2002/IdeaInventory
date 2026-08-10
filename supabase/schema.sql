-- ============================================================================
-- Idea Inventory — database schema
--
-- Paste this whole file into the Supabase SQL editor and run it once.
-- (Supabase dashboard → SQL Editor → New query → paste → Run.)
--
-- Design notes:
--  * Row Level Security is on for every table and every policy is
--    `auth.uid() = user_id`, so a signed-in person can only ever read or
--    write their own rows. The anon key shipped with the app is public by
--    design — these policies are what actually protect the data.
--  * `updated_at` is stamped by the database, never by the client. The app
--    syncs by asking for "everything changed since <last updated_at I saw>",
--    which only works if one clock decides. A laptop with a slow clock can
--    therefore never hide a change from a phone.
--  * Deletes are soft: `deleted_at` is set and the row stays, so other
--    devices find out the row went away. Without tombstones a delete on one
--    device would be silently undone by the next sync from another.
--  * Ids are text, generated on the device, so an idea created offline keeps
--    the same id once it reaches the server.
-- ============================================================================

-- --- Tables -----------------------------------------------------------------

create table if not exists public.ideas (
  id           text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text,
  description  text,
  why          text,
  who          text,
  value        text,
  priority     integer,
  status       text,
  start_date   date,
  created_at   timestamptz,
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table if not exists public.tasks (
  id           text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  idea_id      text,
  title        text,
  status       text,
  priority     boolean,
  due          date,
  start        date,
  days         integer,
  position     integer,
  archived     boolean,
  created_at   timestamptz,
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table if not exists public.notes (
  id         text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  task_id    text,
  body       text,
  created_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Deliberately no foreign keys between ideas → tasks → notes. A sync client
-- pushes in batches and must not have a whole batch rejected because one
-- parent row is still on its way; the app keeps the relationships tidy itself.

create index if not exists ideas_user_updated_idx on public.ideas (user_id, updated_at);
create index if not exists tasks_user_updated_idx on public.tasks (user_id, updated_at);
create index if not exists notes_user_updated_idx on public.notes (user_id, updated_at);
create index if not exists tasks_idea_idx on public.tasks (idea_id);
create index if not exists notes_task_idx on public.notes (task_id);

-- --- The database owns `updated_at` -----------------------------------------

create or replace function public.stamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ideas_stamp_updated_at on public.ideas;
create trigger ideas_stamp_updated_at
  before insert or update on public.ideas
  for each row execute function public.stamp_updated_at();

drop trigger if exists tasks_stamp_updated_at on public.tasks;
create trigger tasks_stamp_updated_at
  before insert or update on public.tasks
  for each row execute function public.stamp_updated_at();

drop trigger if exists notes_stamp_updated_at on public.notes;
create trigger notes_stamp_updated_at
  before insert or update on public.notes
  for each row execute function public.stamp_updated_at();

-- --- Row Level Security ------------------------------------------------------

alter table public.ideas enable row level security;
alter table public.tasks enable row level security;
alter table public.notes enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['ideas', 'tasks', 'notes'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);

    execute format(
      'create policy %I on public.%I for select using (auth.uid() = user_id)',
      t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert with check (auth.uid() = user_id)',
      t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete using (auth.uid() = user_id)',
      t || '_delete_own', t);
  end loop;
end;
$$;

-- --- Housekeeping ------------------------------------------------------------
-- Tombstones only need to outlive the slowest device. Anything soft-deleted
-- more than 90 days ago can go for good. Run it by hand, or schedule it with
-- pg_cron if you have it enabled.

create or replace function public.purge_old_tombstones()
returns void
language sql
as $$
  delete from public.notes where deleted_at < now() - interval '90 days';
  delete from public.tasks where deleted_at < now() - interval '90 days';
  delete from public.ideas where deleted_at < now() - interval '90 days';
$$;
