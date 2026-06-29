const express = require('express');
const router = express.Router();
const {
  obtenerInventario,
  obtenerItemInventario,
  crearItemInventario,
  actualizarItemInventario,
  ajustarCantidad,
  eliminarItemInventario
} = require('./inventario.controller');
const { verificarToken } = require('../../middlewares/auth');
const { verificarRol } = require('../../middlewares/roles');

// Solo admin
router.use(verificarToken, verificarRol('admin'));

// GET /api/inventario
router.get('/', obtenerInventario);

// GET /api/inventario/:id
router.get('/:id', obtenerItemInventario);

// POST /api/inventario
router.post('/', crearItemInventario);

// PUT /api/inventario/:id
router.put('/:id', actualizarItemInventario);

// PATCH /api/inventario/:id/cantidad
router.patch('/:id/cantidad', ajustarCantidad);

// DELETE /api/inventario/:id
router.delete('/:id', eliminarItemInventario);

module.exports = router;