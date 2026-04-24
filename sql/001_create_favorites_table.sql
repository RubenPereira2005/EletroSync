-- =====================================================================
-- Migração 001 — Criar tabela de favoritos
-- =====================================================================
-- Guarda os produtos favoritos de cada utilizador autenticado.
-- O snapshot do produto fica em `product_data` (JSONB) para não
-- precisarmos de re-scrapar cada vez que listamos os favoritos.
-- =====================================================================

-- 1. Criar tabela de favoritos
create table public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  product_data jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

-- 2. Index para queries rápidas por utilizador
create index favorites_user_id_idx on public.favorites(user_id);

-- 3. Activar Row Level Security (RLS)
alter table public.favorites enable row level security;

-- 4. Policies: cada utilizador só vê e manipula os SEUS favoritos
create policy "Utilizadores veem os seus favoritos"
  on public.favorites for select
  using (auth.uid() = user_id);

create policy "Utilizadores adicionam os seus favoritos"
  on public.favorites for insert
  with check (auth.uid() = user_id);

create policy "Utilizadores removem os seus favoritos"
  on public.favorites for delete
  using (auth.uid() = user_id);
