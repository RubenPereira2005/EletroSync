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

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor a correr em http://localhost:${PORT}`);
});
