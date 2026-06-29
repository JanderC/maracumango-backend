const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// CORS — acepta el frontend de Vercel y localhost
const originesPermitidos = [
  'https://maracumango-beta.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001'
];

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (Postman, Railway health checks)
    if (!origin) return callback(null, true);
    if (originesPermitidos.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('No permitido por CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Manejo de preflight OPTIONS
app.options('*', cors());

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