require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Servir arquivos da raiz para CSS, Scripts e Imagens
app.use(express.static(path.join(__dirname)));
app.use(express.json());

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

const productsRoutes = require('./routes/products');
app.use('/api/products', productsRoutes);

// Endpoint leve para UptimeRobot manter o servidor acordado.
// Devolve um pequeno JSON com uptime — não consome banda nem créditos Serper.
const SERVER_START = Date.now();
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.round((Date.now() - SERVER_START) / 1000),
    timestamp: new Date().toISOString(),
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor a correr em http://localhost:${PORT}`);

  // Arrancar auto-refresh agendado da cache Serper (corre 2x/dia: 6h e 18h)
  if (typeof productsRoutes.scheduleAutoRefresh === 'function') {
    productsRoutes.scheduleAutoRefresh(PORT);
  }
});
