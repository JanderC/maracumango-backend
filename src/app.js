const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// CORS manual — headers directamente en cada respuesta
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://maracumango-beta.vercel.app');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,Accept,Origin,X-Requested-With');

  // Responder preflight inmediatamente
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rutas
app.use('/api/auth', require('./modules/auth/auth.routes'));
app.use('/api/usuarios', require('./modules/usuarios/usuarios.routes'));
app.use('/api/categorias', require('./modules/categorias/categorias.routes'));
app.use('/api/productos', require('./modules/productos/productos.routes'));
app.use('/api/toppings', require('./modules/toppings/toppings.routes'));
app.use('/api/tasas-cambio', require('./modules/tasas_cambio/tasas_cambio.routes'));
app.use('/api/cuentas-bancarias', require('./modules/cuentas_bancarias/cuentas_bancarias.routes'));
app.use('/api/ventas', require('./modules/ventas/ventas.routes'));
app.use('/api/reportes', require('./modules/reportes/reportes.routes'));
app.use('/api/inventario', require('./modules/inventario/inventario.routes'));

// Ruta base
app.get('/', (req, res) => {
  res.json({ mensaje: '🥭 Maracu Mango API funcionando correctamente' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ mensaje: 'Ruta no encontrada' });
});

// Error global
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ mensaje: 'Error interno del servidor', error: err.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});

module.exports = app;