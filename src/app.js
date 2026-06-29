const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middlewares globales
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));
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

// Manejo de rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ mensaje: 'Ruta no encontrada' });
});

// Manejo de errores globales
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ mensaje: 'Error interno del servidor', error: err.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});

module.exports = app;