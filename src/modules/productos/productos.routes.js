const express = require('express');
const router = express.Router();
const {
  obtenerProductos,
  obtenerProductosActivos,
  obtenerVariantesProducto,
  obtenerProducto,
  crearProducto,
  actualizarProducto,
  toggleActivoProducto,
  eliminarProducto,
  obtenerRecetaProducto,
  guardarRecetaProducto
} = require('./productos.controller');
const { verificarToken } = require('../../middlewares/auth');
const { verificarRol } = require('../../middlewares/roles');
const { upload } = require('../../config/cloudinary');

// Públicas con token (admin, vendedor y cliente)
router.get('/activos', verificarToken, obtenerProductosActivos);
router.get('/:id/variantes', verificarToken, obtenerVariantesProducto);
router.get('/:id', verificarToken, obtenerProducto);

// Solo admin
router.get('/', verificarToken, verificarRol('admin'), obtenerProductos);
router.post('/', verificarToken, verificarRol('admin'), upload.single('imagen'), crearProducto);
router.put('/:id', verificarToken, verificarRol('admin'), upload.single('imagen'), actualizarProducto);
router.patch('/:id/toggle', verificarToken, verificarRol('admin'), toggleActivoProducto);
router.delete('/:id', verificarToken, verificarRol('admin'), eliminarProducto);

// Receta de insumos
router.get('/:id/receta', verificarToken, verificarRol('admin'), obtenerRecetaProducto);
router.post('/:id/receta', verificarToken, verificarRol('admin'), guardarRecetaProducto);

module.exports = router;