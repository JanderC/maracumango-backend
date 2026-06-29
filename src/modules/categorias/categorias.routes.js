const express = require('express');
const router = express.Router();
const {
  obtenerCategorias,
  obtenerCategoria,
  crearCategoria,
  actualizarCategoria,
  eliminarCategoria
} = require('./categorias.controller');
const { verificarToken } = require('../../middlewares/auth');
const { verificarRol } = require('../../middlewares/roles');

// GET público para el catálogo
router.get('/', verificarToken, obtenerCategorias);
router.get('/:id', verificarToken, obtenerCategoria);

// Solo admin
router.post('/', verificarToken, verificarRol('admin'), crearCategoria);
router.put('/:id', verificarToken, verificarRol('admin'), actualizarCategoria);
router.delete('/:id', verificarToken, verificarRol('admin'), eliminarCategoria);

module.exports = router;