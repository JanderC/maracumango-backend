const express = require('express');
const router = express.Router();
const {
  obtenerToppings,
  obtenerTopping,
  crearTopping,
  actualizarTopping,
  toggleActivoTopping,
  eliminarTopping,
  obtenerRecetaTopping,
  guardarRecetaTopping
} = require('./toppings.controller');
const { verificarToken } = require('../../middlewares/auth');
const { verificarRol } = require('../../middlewares/roles');

// Accesible para admin y cliente
router.get('/', verificarToken, obtenerToppings);
router.get('/:id', verificarToken, obtenerTopping);

// Solo admin
router.post('/', verificarToken, verificarRol('admin'), crearTopping);
router.put('/:id', verificarToken, verificarRol('admin'), actualizarTopping);
router.patch('/:id/toggle', verificarToken, verificarRol('admin'), toggleActivoTopping);
router.delete('/:id', verificarToken, verificarRol('admin'), eliminarTopping);

// Receta de insumos
router.get('/:id/receta', verificarToken, verificarRol('admin'), obtenerRecetaTopping);
router.post('/:id/receta', verificarToken, verificarRol('admin'), guardarRecetaTopping);

module.exports = router;