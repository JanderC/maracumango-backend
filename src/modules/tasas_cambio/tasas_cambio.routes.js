const express = require('express');
const router = express.Router();
const {
  obtenerTasasBCV,
  obtenerTasas,
  obtenerTasaActiva,
  guardarTasaManual,
  importarTasaBCV
} = require('./tasas_cambio.controller');
const { verificarToken } = require('../../middlewares/auth');
const { verificarRol } = require('../../middlewares/roles');

// Consultar BCV en tiempo real (admin y cliente)
router.get('/bcv', verificarToken, obtenerTasasBCV);

// Obtener todas las tasas guardadas
router.get('/', verificarToken, obtenerTasas);

// Obtener tasa activa por moneda — usada al momento de procesar ventas
router.get('/activa/:moneda', verificarToken, obtenerTasaActiva);

// Solo admin
router.post('/manual', verificarToken, verificarRol('admin'), guardarTasaManual);
router.post('/importar-bcv', verificarToken, verificarRol('admin'), importarTasaBCV);

module.exports = router;