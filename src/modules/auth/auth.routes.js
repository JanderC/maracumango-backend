const express = require('express');
const router = express.Router();
const { login, perfil } = require('./auth.controller');
const { verificarToken } = require('../../middlewares/auth');

// POST /api/auth/login
router.post('/login', login);

// GET /api/auth/perfil
router.get('/perfil', verificarToken, perfil);

module.exports = router;