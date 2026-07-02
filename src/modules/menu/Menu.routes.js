const express = require('express');
const router = express.Router();
const {
  obtenerProductosMenu,
  obtenerProductoMenu,
  obtenerCategoriasMenu,
  obtenerToppingsMenu
} = require('./menu.controller');

// Sin verificarToken a propósito: esta es la pantalla pública de menú,
// pensada para clientes sin cuenta (ej. QR en mesa, link compartido)..
router.get('/productos', obtenerProductosMenu);
router.get('/productos/:id', obtenerProductoMenu);
router.get('/categorias', obtenerCategoriasMenu);
router.get('/toppings', obtenerToppingsMenu);

module.exports = router;