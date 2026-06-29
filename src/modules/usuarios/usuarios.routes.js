const express = require('express');
const router = express.Router();
const {
  obtenerUsuarios,
  obtenerUsuario,
  crearUsuario,
  actualizarUsuario,
  toggleActivoUsuario
} = require('./usuarios.controller');
const { verificarToken } = require('../../middlewares/auth');
const { verificarRol } = require('../../middlewares/roles');

// Todas las rutas requieren token y rol admin
router.use(verificarToken, verificarRol('admin'));

// GET /api/usuarios
router.get('/', obtenerUsuarios);

// GET /api/usuarios/:id
router.get('/:id', obtenerUsuario);

// POST /api/usuarios
router.post('/', crearUsuario);

// PUT /api/usuarios/:id
router.put('/:id', actualizarUsuario);

// PATCH /api/usuarios/:id/toggle
router.patch('/:id/toggle', toggleActivoUsuario);

module.exports = router;