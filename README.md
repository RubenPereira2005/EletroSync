# ⚡ EletroSync

![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-404D59?style=for-the-badge)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![Bootstrap](https://img.shields.io/badge/Bootstrap-563D7C?style=for-the-badge&logo=bootstrap&logoColor=white)

> Comparador de preços de eletrónica em Portugal. Compara em tempo real as ofertas da **Worten**, **FNAC**, **Rádio Popular** e **PC Diga** para o mesmo produto.

🌐 **Em Produção:** [eletrosync.onrender.com](https://eletrosync.onrender.com)

---

## ✨ Funcionalidades Principais

- **Comparação em Tempo Real:** Obtém sempre o melhor preço do mercado através da Serper API (Google Shopping).
- **Sistema de Contas:** Autenticação segura de utilizadores gerida pelo Supabase.
- **Área Pessoal:** Adiciona produtos aos teus Favoritos ou ao Carrinho de Compras.
- **Alta Performance:** Sistema de *cache* inteligente para evitar rate limits e carregar dados instantaneamente.

---

## 🛠️ Stack

- **Backend:** Node.js + Express
- **Frontend:** HTML/CSS/JS vanilla + Bootstrap 5
- **Base de Dados / Auth:** Supabase (PostgreSQL + Row Level Security)
- **Fonte de Preços:** Serper API
- **Hosting:** Render.com

---

## 🚀 Setup Local

### 1. Pré-requisitos

- **Node.js** 18+ (recomendado 20)
- Conta no [Supabase](https://supabase.com) com projeto criado
- API key da [Serper.dev](https://serper.dev) (free tier: 2500 créditos/mês)

### 2. Instalar dependências

```bash
git clone [https://github.com/RubenPereira2005/EletroSync.git](https://github.com/RubenPereira2005/EletroSync.git)
cd EletroSync
npm install

### 3. Configurar variáveis de ambiente

Copia o template e preenche com os teus valores:

```bash
cp .env.example .env
```

Edita `.env` e coloca:

```env
PORT=3000
SUPABASE_URL=https://<id>.supabase.co
SUPABASE_ANON_KEY=<chave-anon-publica>
SERPER_API_KEY=<chave-serper>
NODE_ENV=development
```

### 4. Criar tabelas no Supabase

No SQL Editor do Supabase, executa **por ordem**:

1. [sql/001_create_favorites_table.sql](sql/001_create_favorites_table.sql) — tabela de favoritos + RLS
2. [sql/002_create_cart_items_table.sql](sql/002_create_cart_items_table.sql) — tabela do carrinho + RLS

### 5. Configurar Auth do Supabase (para o login funcionar)

No dashboard Supabase → **Authentication** → **URL Configuration**:

- **Site URL:** `http://localhost:3000`
- **Redirect URLs:** adiciona `http://localhost:3000/**`

### 6. Arrancar

```bash
npm start
```

Abre http://localhost:3000

---

## Estrutura do projeto

```
EletroSync/
├── server.js                  # Entry point Express
├── routes/
│   ├── auth.js                # Registo / login / logout via Supabase
│   ├── favorites.js           # CRUD de favoritos (autenticado)
│   ├── cart.js                # CRUD do carrinho (autenticado)
│   ├── products.js            # Catálogo + comparação (Serper)
│   └── store-scraper.js       # Resolve URLs e preços diretos das lojas
├── pages/                     # HTML
├── js/                        # Frontend JS (auth, cart, favorites, products...)
├── css/
│   ├── design-system.css      # Tokens + componentes reutilizáveis
│   └── style.css              # Estilos legacy
├── images/                    # Imagens locais (logos, placeholders)
├── sql/                       # Migrações Supabase
└── cache/                     # Cache persistente da Serper (gitignored)
```

---

## Endpoints da API

### Auth

| Método | Path | Descrição |
|---|---|---|
| `POST` | `/api/auth/register` | Cria conta nova |
| `POST` | `/api/auth/login` | Login (devolve token Supabase) |
| `POST` | `/api/auth/logout` | Termina sessão |

### Favoritos (requer Bearer token)

| Método | Path | Descrição |
|---|---|---|
| `GET` | `/api/favorites` | Lista favoritos do utilizador |
| `POST` | `/api/favorites` | Adiciona um favorito |
| `DELETE` | `/api/favorites/:product_id` | Remove favorito |

### Carrinho (requer Bearer token)

| Método | Path | Descrição |
|---|---|---|
| `GET` | `/api/cart` | Lista itens do carrinho |
| `POST` | `/api/cart` | Adiciona produto |
| `PUT` | `/api/cart/:product_id` | Atualiza quantidade |
| `DELETE` | `/api/cart/:product_id` | Remove item |
| `DELETE` | `/api/cart` | Limpa carrinho |

### Produtos

| Método | Path | Rate limit | Descrição |
|---|---|---|---|
| `GET` | `/api/products/all` | 60/min | Catálogo cacheado (12h) |
| `GET` | `/api/products/search?q=...` | 20/min | Pesquisa com filtro |
| `GET` | `/api/products/compare?q=...` | 20/min | Compara preços nas 4 lojas |
| `GET` | `/api/products/details?q=...` | 20/min | Especificações do produto |
| `GET` | `/api/products/refresh` | 10/h | Limpa cache (admin) |
| `GET` | `/api/products/cache-status` | 60/min | Diagnóstico da cache |

### Outros

| Método | Path | Descrição |
|---|---|---|
| `GET` | `/api/health` | Health check (para UptimeRobot) |

---

## Sistema de cache

O backend usa **cache persistente em disco** (`cache/`) com TTL variável:

| Tipo | TTL | Razão |
|---|---|---|
| `/api/products/all` (catálogo) | 12h | Produtos estáveis |
| `/api/products/compare` (preços) | 2h | Preços mudam mais |
| `/api/products/search` (pesquisa) | 4h | Equilibrado |
| URLs de produto na loja | 7 dias | Quase nunca mudam |

**Auto-refresh** corre **2x por dia** (6h e 18h UTC) — limpa a cache de produtos
e repopula sem intervenção. Para forçar refresh manual:

```bash
curl https://eletrosync.onrender.com/api/products/refresh
```

---

## Deploy

O projeto está hospedado no **Render.com** com deploy automático a partir do
branch `main`. Cada push faz redeploy em ~3-5 min.

### Variáveis de ambiente no Render

Configura em **Settings → Environment**:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SERPER_API_KEY`
- `NODE_ENV=production`
- `NODE_VERSION=20`

### Manter o servidor acordado

O tier Free do Render adormece após 15 min de inatividade. Usamos
[UptimeRobot](https://uptimerobot.com) para fazer ping ao `/api/health` a cada
10 minutos, mantendo o serviço sempre desperto.

---

## Segurança

- **Row Level Security** ativo em todas as tabelas Supabase (cada user só vê os seus dados)
- **Rate limiting** por IP em todas as rotas que consomem Serper
- **Validação de input** em todos os endpoints autenticados
- **Tokens Supabase** validados a cada request via middleware `requireAuth`
- **`.env`** nunca commitado (`.gitignore` configurado)
- **trust proxy** configurado para o rate limiter ver IPs reais por trás do Render

---

## Licença

Projeto académico — ISEC, Engenharia Informática.
