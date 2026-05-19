require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Confiar no proxy do Render (X-Forwarded-For) para o rate limiter ver IPs reais.
// '1' = confia em 1 hop de proxy (o do Render). Não usar 'true' por segurança.
app.set('trust proxy', 1);

// Limitar tamanho do JSON do body (evita uploads grandes a esgotar memória)
app.use(express.json({ limit: '100kb' }));

// Servir arquivos da raiz para CSS, Scripts e Imagens
app.use(express.static(path.join(__dirname)));

// Servir as páginas HTML automaticamente da pasta 'pages' 
// O { extensions: ['html'] } permite aceder a localhost:3000/login (sem o .html no fim)
app.use(express.static(path.join(__dirname, 'pages'), { extensions: ['html'] }));

// API Routes
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

const favoritesRoutes = require('./routes/favorites');
app.use('/api/favorites', favoritesRoutes);

const cartRoutes = require('./routes/cart');
app.use('/api/cart', cartRoutes);

const ordersRoutes = require('./routes/orders');
app.use('/api/orders', ordersRoutes);

const productsRoutes = require('./routes/products');
app.use('/api/products', productsRoutes);

// Endpoint leve para UptimeRobot manter o servidor acordado.
// Devolve um pequeno JSON com uptime - não consome banda nem créditos Serper.
const SERVER_START = Date.now();
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.round((Date.now() - SERVER_START) / 1000),
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS DE ERRO - devem vir DEPOIS das rotas
// ═══════════════════════════════════════════════════════════════════════════

// 404 para rotas API não encontradas (rotas HTML caem em express.static)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint não encontrado.' });
  }
  next();
});

// Error handler global. Em produção esconde stack trace para não vazar info
// interna do servidor; em dev mostra detalhe para facilitar debug.
app.use((err, req, res, next) => {
  // Sempre registar o erro completo no log do servidor
  console.error('[server error]', err.stack || err);

  // Erro de JSON inválido no body (express.json() throws SyntaxError)
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido no corpo do pedido.' });
  }
  // Body grande de mais (limit do express.json)
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Pedido demasiado grande.' });
  }
  // Request abortado pelo cliente (não é erro real)
  if (err.code === 'ECONNABORTED' || err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
    return; // resposta já enviada
  }

  const status = err.status || err.statusCode || 500;
  if (IS_PROD) {
    res.status(status).json({ error: 'Erro interno do servidor.' });
  } else {
    res.status(status).json({
      error: err.message || 'Erro interno do servidor.',
      stack: err.stack,
    });
  }
});

// Apanhar exceções não tratadas que poderiam matar o processo
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor a correr em http://localhost:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);

  // Arrancar auto-refresh agendado da cache Serper (corre 2x/dia: 6h e 18h)
  if (typeof productsRoutes.scheduleAutoRefresh === 'function') {
    productsRoutes.scheduleAutoRefresh(PORT);
  }
});
