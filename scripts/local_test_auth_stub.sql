-- Local-only stub of Supabase's `auth` schema, for validating migrations
-- against a plain Postgres instance in a sandbox with no Supabase project.
-- This file is NOT part of the real migration set and must never be run
-- against an actual Supabase database (which already provides `auth`).
create extension if not exists "pgcrypto";
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);
create or replace function auth.uid() returns uuid
language sql stable as $$ select null::uuid; $$;
