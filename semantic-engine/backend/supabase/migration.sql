-- ============================================================
-- Semantic File Manager — Supabase Migration
-- ============================================================
-- Run this in the Supabase SQL editor or via a migration tool.
-- ============================================================

-- ── users ─────────────────────────────────────────────────────
-- Stores users identified by their Telegram ID.
create table if not exists users (
  id           bigint      primary key,  -- Telegram user ID
  username     text,
  display_name text,
  created_at   timestamptz not null default now()
);

-- ── folders ───────────────────────────────────────────────────
-- Two types:
--   'file_type' → auto-created per MIME category (video, image, audio, document, other)
--   'job'       → user-created project container for mixed files
create table if not exists folders (
  id         uuid        primary key default gen_random_uuid(),
  user_id    bigint      not null references users(id) on delete cascade,
  name       text        not null,
  type       text        not null default 'file_type',   -- 'file_type' | 'job'
  category   text,       -- for file_type: video / image / audio / document / other
  created_at timestamptz not null default now()
);

create index if not exists idx_folders_user_id on folders (user_id);
create unique index if not exists idx_folders_user_category
  on folders (user_id, category) where type = 'file_type';

-- ── files ─────────────────────────────────────────────────────
-- Stores metadata for every uploaded file.
-- status: 'pending' → 'processing' → 'indexed' | 'failed'
create table if not exists files (
  id          uuid        primary key default gen_random_uuid(),
  user_id     bigint      references users(id) on delete cascade,
  folder_id   uuid        references folders(id) on delete set null,
  name        text        not null,
  storage_key text        not null,
  type        text,
  size        bigint,
  status      text        not null default 'pending',
  created_at  timestamptz not null default now()
);

create index if not exists idx_files_status on files (status);
create index if not exists idx_files_user_id on files (user_id);
create index if not exists idx_files_folder_id on files (folder_id);

-- ── chunks ────────────────────────────────────────────────────
-- Stores semantic chunks extracted from each file.
-- Each chunk maps to a vector in Qdrant via vector_id.
create table if not exists chunks (
  id          uuid        primary key default gen_random_uuid(),
  file_id     uuid        not null references files(id) on delete cascade,
  vector_id   text,
  text        text,
  start_time  float,
  end_time    float,
  page        int,
  confidence  float,
  created_at  timestamptz not null default now()
);

create index if not exists idx_chunks_file_id on chunks (file_id);
