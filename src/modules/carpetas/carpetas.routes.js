const express = require('express');
const router = express.Router();
const {
  obtenerCarpetas,
  obtenerCarpetasActivas,
  obtenerCarpeta,
  crearCarpeta,
  actualizarCarpeta,
  toggleActivoCarpeta,
  eliminarCarpeta,
  reordenarCarpetas,
  reordenarProductos
} = require('./carpetas.controller');
const { verificarToken } = require('../../middlewares/auth');
const { verificarRol } = require('../../middlewares/roles');
const { upload } = require('../../config/cloudinary');

// Accesible para cualquier usuario autenticado (catálogo público / POS)
// Ambas soportan ?carpeta_padre_id= para navegar subcarpetas
router.get('/activas', verificarToken, obtenerCarpetasActivas);
router.get('/:id', verificarToken, obtenerCarpeta);

// Solo admin
router.get('/', verificarToken, verificarRol('admin'), obtenerCarpetas);
router.post('/', verificarToken, verificarRol('admin'), upload.single('imagen'), crearCarpeta);
router.put('/:id', verificarToken, verificarRol('admin'), upload.single('imagen'), actualizarCarpeta);
router.patch('/:id/toggle', verificarToken, verificarRol('admin'), toggleActivoCarpeta);
router.delete('/:id', verificarToken, verificarRol('admin'), eliminarCarpeta);

// Reordenar (drag & drop en el panel admin)
router.patch('/reordenar/carpetas', verificarToken, verificarRol('admin'), reordenarCarpetas);
router.patch('/reordenar/productos', verificarToken, verificarRol('admin'), reordenarProductos);

module.exports = router;