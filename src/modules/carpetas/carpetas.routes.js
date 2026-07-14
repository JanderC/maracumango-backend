const express = require('express');
const router = express.Router();
const {
  obtenerCarpetas,
  obtenerCarpetasActivas,
  obtenerCarpeta,
  crearCarpeta,
  actualizarCarpeta,
  toggleActivoCarpeta,
  eliminarCarpeta
} = require('./carpetas.controller');
const { verificarToken } = require('../../middlewares/auth');
const { verificarRol } = require('../../middlewares/roles');
const { upload } = require('../../config/cloudinary');

// Accesible para cualquier usuario autenticado (catálogo público / POS)
router.get('/activas', verificarToken, obtenerCarpetasActivas);
router.get('/:id', verificarToken, obtenerCarpeta);

// Solo admin
router.get('/', verificarToken, verificarRol('admin'), obtenerCarpetas);
router.post('/', verificarToken, verificarRol('admin'), upload.single('imagen'), crearCarpeta);
router.put('/:id', verificarToken, verificarRol('admin'), upload.single('imagen'), actualizarCarpeta);
router.patch('/:id/toggle', verificarToken, verificarRol('admin'), toggleActivoCarpeta);
router.delete('/:id', verificarToken, verificarRol('admin'), eliminarCarpeta);

module.exports = router;
