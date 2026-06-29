const express = require('express');
const router = express.Router();
const {
  obtenerVentas,
  obtenerVenta,
  crearVenta,
  anularVenta
} = require('./ventas.controller');
const { verificarToken } = require('../../middlewares/auth');
const { verificarRol } = require('../../middlewares/roles');

// Admin ve todas las ventas, cliente solo puede crear
router.get('/', verificarToken, verificarRol('admin'), obtenerVentas);
router.get('/:id', verificarToken, obtenerVenta);
router.post('/', verificarToken, crearVenta);
router.patch('/:id/anular', verificarToken, verificarRol('admin'), anularVenta);

module.exports = router;