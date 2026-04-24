-- =====================================================================
-- Migração 002 — Criar tabela de itens do carrinho
-- =====================================================================
-- Guarda os produtos no carrinho de cada utilizador autenticado, com a
-- quantidade associada. O snapshot do produto fica em `product_data`
-- (JSONB) para não precisarmos de re-scrapar cada vez que listamos o
-- carrinho.
-- =====================================================================

-- 1. Criar tabela de itens do carrinho
create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  product_data jsonb not null,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

-- 2. Index para queries rápidas por utilizador
create index cart_items_user_id_idx on public.cart_items(user_id);

-- 3. Trigger para manter `updated_at` atualizado automaticamente
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger cart_items_set_updated_at
  before update on public.cart_items
  for each row execute function public.set_updated_at();

-- 4. Activar Row Level Security (RLS)
alter table public.cart_items enable row level security;

-- 5. Policies: cada utilizador só vê e manipula os SEUS itens
create policy "Utilizadores veem os seus itens de carrinho"
  on public.cart_items for select
  using (auth.uid() = user_id);

create policy "Utilizadores adicionam aos seus itens de carrinho"
  on public.cart_items for insert
  with check (auth.uid() = user_id);

create policy "Utilizadores atualizam os seus itens de carrinho"
  on public.cart_items for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Utilizadores removem os seus itens de carrinho"
  on public.cart_items for delete
  using (auth.uid() = user_id);
