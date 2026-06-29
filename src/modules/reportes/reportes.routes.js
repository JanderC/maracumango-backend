const express = require('express');
const router = express.Router();
const {
  resumenGeneral,
  ventasPorDia,
  reporteInventario,
  exportarVentasExcel,
  exportarVentasPDF
} = require('./reportes.controller');
const { verificarToken } = require('../../middlewares/auth');
const { verificarRol } = require('../../middlewares/roles');

// Solo admin
router.use(verificarToken, verificarRol('admin'));

// GET /api/reportes/resumen
router.get('/resumen', resumenGeneral);

// GET /api/reportes/ventas-por-dia
router.get('/ventas-por-dia', ventasPorDia);

// GET /api/reportes/inventario
router.get('/inventario', reporteInventario);

// GET /api/reportes/exportar/excel
router.get('/exportar/excel', exportarVentasExcel);

// GET /api/reportes/exportar/pdf
router.get('/exportar/pdf', exportarVentasPDF);

module.exports = router;