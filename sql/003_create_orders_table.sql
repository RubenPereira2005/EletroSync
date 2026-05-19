-- =====================================================================
-- Migração 003 — Criar tabela de pedidos (orders)
-- =====================================================================
-- Guarda os "pedidos" feitos pelo utilizador através do checkout. Como
-- o EletroSync é um comparador (não vende), o checkout é simulado: o
-- pedido é registado mas não há pagamento real envolvido.
--
-- `items` guarda um snapshot dos produtos comprados (nome, preço, loja
-- escolhida) para preservar o estado mesmo se o produto sair de catálogo.
-- `shipping_info` guarda morada, nome, telefone preenchidos no checkout.
-- =====================================================================

-- 1. Criar tabela de pedidos
create table public.orders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    status text not null default 'completed' check (status in ('pending', 'completed', 'cancelled')),
    items jsonb not null,
    total numeric(10, 2) not null check (total >= 0),
    shipping_info jsonb,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 2. Index para listar pedidos por utilizador rapidamente
create index orders_user_id_idx on public.orders(user_id);
create index orders_created_at_idx on public.orders(created_at desc);

-- 3. Reaproveitar o trigger set_updated_at (criado na migração 002)
create trigger orders_set_updated_at
    before update on public.orders
    for each row execute function public.set_updated_at();

-- 4. Activar Row Level Security
alter table public.orders enable row level security;

-- 5. Policies: cada utilizador só vê os SEUS pedidos
create policy "Utilizadores veem os seus pedidos"
    on public.orders for select
    using (auth.uid() = user_id);

create policy "Utilizadores criam os seus pedidos"
    on public.orders for insert
    with check (auth.uid() = user_id);

-- Não permitimos UPDATE nem DELETE de pedidos pelo utilizador.
-- Cancelamento futuro pode ser feito via service_role se for preciso.
