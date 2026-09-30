const express = require('express');
const router = express.Router();
const {
  obtenerCajaActual,
  abrirCaja,
  cerrarCaja,
  crearMovimiento,
  eliminarMovimiento,
  obtenerSesiones,
  obtenerSesion,
  obtenerDiario,
  previewSemana,
  cerrarSemana,
  obtenerCierresSemanales,
  eliminarVentasSemana,
  eliminarCierreSemanal
} = require('./caja.controller');
const { verificarToken } = require('../../middlewares/auth');
const { verificarRol } = require('../../middlewares/roles');

const cajeros = verificarRol('admin', 'vendedor');
const admin = verificarRol('admin');

// Operación diaria (admin y vendedor)
router.get('/actual', verificarToken, cajeros, obtenerCajaActual);
router.post('/abrir', verificarToken, cajeros, abrirCaja);
router.post('/cerrar', verificarToken, cajeros, cerrarCaja);
router.post('/movimientos', verificarToken, cajeros, crearMovimiento);

// Solo admin
router.delete('/movimientos/:id', verificarToken, admin, eliminarMovimiento);
router.get('/sesiones', verificarToken, admin, obtenerSesiones);
router.get('/sesiones/:id', verificarToken, admin, obtenerSesion);
router.get('/diario', verificarToken, admin, obtenerDiario);
router.get('/semanal/preview', verificarToken, admin, previewSemana);
router.post('/semanal/cerrar', verificarToken, admin, cerrarSemana);
router.get('/semanal', verificarToken, admin, obtenerCierresSemanales);
router.delete('/semanal/:id/ventas', verificarToken, admin, eliminarVentasSemana);
router.delete('/semanal/:id', verificarToken, admin, eliminarCierreSemanal);

module.exports = router;
