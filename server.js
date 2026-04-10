const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

// Servir ficheiros estáticos
app.use(express.static(path.join(__dirname)));

// Rotas
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/product', (req, res) => {
  res.sendFile(path.join(__dirname, 'product.html'));
});

app.get('/product-profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'product-profile.html'));
});

app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'profile.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor a correr em http://localhost:${PORT}`);
});
