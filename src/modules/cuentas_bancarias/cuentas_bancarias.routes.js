const express = require('express');
const router = express.Router();
const {
  obtenerCuentas,
  obtenerCuentasPorMoneda,
  obtenerCuenta,
  crearCuenta,
  actualizarCuenta,
  toggleActivoCuenta,
  eliminarCuenta
} = require('./cuentas_bancarias.controller');
const { verificarToken } = require('../../middlewares/auth');
const { verificarRol } = require('../../middlewares/roles');

// Accesible para admin y cliente (necesario al momento de pagar)
router.get('/', verificarToken, obtenerCuentas);
router.get('/moneda/:moneda', verificarToken, obtenerCuentasPorMoneda);
router.get('/:id', verificarToken, obtenerCuenta);

// Solo admin
router.post('/', verificarToken, verificarRol('admin'), crearCuenta);
router.put('/:id', verificarToken, verificarRol('admin'), actualizarCuenta);
router.patch('/:id/toggle', verificarToken, verificarRol('admin'), toggleActivoCuenta);
router.delete('/:id', verificarToken, verificarRol('admin'), eliminarCuenta);

module.exports = router;