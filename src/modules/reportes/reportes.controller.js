const pool = require('../../config/db');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// Resumen general
const resumenGeneral = async (req, res) => {
  const { fecha_inicio, fecha_fin } = req.query;

  try {
    const params = [];
    let filtroFecha = '';
    let contador = 1;

    if (fecha_inicio) {
      filtroFecha += ` AND DATE(v.creado_en) >= $${contador}`;
      params.push(fecha_inicio);
      contador++;
    }
    if (fecha_fin) {
      filtroFecha += ` AND DATE(v.creado_en) <= $${contador}`;
      params.push(fecha_fin);
      contador++;
    }

    // Total ventas y ganancias
    const totales = await pool.query(
      `SELECT
        COUNT(v.id) AS total_ventas,
        COALESCE(SUM(v.total_usd), 0) AS total_ingresos_usd,
        COALESCE(SUM(iv.ganancia_usd), 0) AS total_ganancias_usd
       FROM ventas v
       LEFT JOIN items_venta iv ON iv.venta_id = v.id
       WHERE v.tipo_pago != 'anulada' ${filtroFecha}`,
      params
    );

    // Ventas por moneda
    const porMoneda = await pool.query(
      `SELECT moneda_pago, COUNT(*) AS cantidad, SUM(total_pagado) AS total
       FROM ventas
       WHERE tipo_pago != 'anulada' ${filtroFecha.replace(/v\./g, '')}
       GROUP BY moneda_pago`,
      params
    );

    // Ventas por tipo de pago
    const porTipoPago = await pool.query(
      `SELECT tipo_pago, COUNT(*) AS cantidad, SUM(total_usd) AS total_usd
       FROM ventas
       WHERE tipo_pago != 'anulada' ${filtroFecha.replace(/v\./g, '')}
       GROUP BY tipo_pago`,
      params
    );

    // Productos más vendidos
    const masVendidos = await pool.query(
      `SELECT p.nombre,
              SUM(iv.cantidad) AS unidades_vendidas,
              SUM(iv.subtotal_usd) AS total_usd,
              SUM(iv.ganancia_usd) AS ganancia_usd
       FROM items_venta iv
       LEFT JOIN productos p ON iv.producto_id = p.id
       LEFT JOIN ventas v ON iv.venta_id = v.id
       WHERE v.tipo_pago != 'anulada' ${filtroFecha}
       GROUP BY p.nombre
       ORDER BY unidades_vendidas DESC
       LIMIT 10`,
      params
    );

    res.json({
      resumen: totales.rows[0],
      por_moneda: porMoneda.rows,
      por_tipo_pago: porTipoPago.rows,
      productos_mas_vendidos: masVendidos.rows
    });
  } catch (err) {
    console.error('Error generando resumen:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// Reporte de ventas por día
const ventasPorDia = async (req, res) => {
  const { fecha_inicio, fecha_fin } = req.query;

  try {
    const params = [];
    let filtro = 'WHERE v.tipo_pago != \'anulada\'';
    let contador = 1;

    if (fecha_inicio) {
      filtro += ` AND DATE(v.creado_en) >= $${contador}`;
      params.push(fecha_inicio);
      contador++;
    }
    if (fecha_fin) {
      filtro += ` AND DATE(v.creado_en) <= $${contador}`;
      params.push(fecha_fin);
      contador++;
    }

    const resultado = await pool.query(
      `SELECT
        DATE(v.creado_en) AS fecha,
        COUNT(v.id) AS total_ventas,
        SUM(v.total_usd) AS total_usd,
        SUM(iv.ganancia_usd) AS ganancia_usd
       FROM ventas v
       LEFT JOIN items_venta iv ON iv.venta_id = v.id
       ${filtro}
       GROUP BY DATE(v.creado_en)
       ORDER BY fecha DESC`,
      params
    );

    res.json({ ventas_por_dia: resultado.rows });
  } catch (err) {
    console.error('Error reporte ventas por dia:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// Reporte de inventario
const reporteInventario = async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT i.*,
              c.nombre AS categoria,
              COALESCE(p.total_productos, 0) AS productos_asociados
       FROM inventario i
       LEFT JOIN categorias c ON i.categoria_id = c.id
       LEFT JOIN (
         SELECT inventario_id, COUNT(*) AS total_productos
         FROM productos
         GROUP BY inventario_id
       ) p ON p.inventario_id = i.id
       ORDER BY i.nombre ASC`
    );

    res.json({ inventario: resultado.rows });
  } catch (err) {
    console.error('Error reporte inventario:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// Exportar ventas a Excel
const exportarVentasExcel = async (req, res) => {
  const { fecha_inicio, fecha_fin } = req.query;

  try {
    const params = [];
    let filtro = 'WHERE v.tipo_pago != \'anulada\'';
    let contador = 1;

    if (fecha_inicio) {
      filtro += ` AND DATE(v.creado_en) >= $${contador}`;
      params.push(fecha_inicio);
      contador++;
    }
    if (fecha_fin) {
      filtro += ` AND DATE(v.creado_en) <= $${contador}`;
      params.push(fecha_fin);
      contador++;
    }

    const ventas = await pool.query(
      `SELECT
        v.id,
        TO_CHAR(v.creado_en, 'DD/MM/YYYY HH24:MI') AS fecha,
        u.nombre AS cajero,
        v.total_usd,
        v.total_pagado,
        v.moneda_pago,
        v.tipo_pago,
        cb.nombre_banco,
        cb.titular_cuenta,
        v.tasa_cambio_usada,
        v.notas,
        SUM(iv.ganancia_usd) AS ganancia_usd
       FROM ventas v
       LEFT JOIN usuarios u ON v.usuario_id = u.id
       LEFT JOIN cuentas_bancarias cb ON v.cuenta_bancaria_id = cb.id
       LEFT JOIN items_venta iv ON iv.venta_id = v.id
       ${filtro}
       GROUP BY v.id, u.nombre, cb.nombre_banco, cb.titular_cuenta
       ORDER BY v.creado_en DESC`,
      params
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Maracu Mango';

    const hoja = workbook.addWorksheet('Ventas');

    // Estilo encabezado
    hoja.columns = [
      { header: '# Venta', key: 'id', width: 10 },
      { header: 'Fecha', key: 'fecha', width: 20 },
      { header: 'Cajero', key: 'cajero', width: 20 },
      { header: 'Total USD', key: 'total_usd', width: 15 },
      { header: 'Total Pagado', key: 'total_pagado', width: 15 },
      { header: 'Moneda', key: 'moneda_pago', width: 10 },
      { header: 'Tipo Pago', key: 'tipo_pago', width: 15 },
      { header: 'Banco', key: 'nombre_banco', width: 20 },
      { header: 'Titular', key: 'titular_cuenta', width: 20 },
      { header: 'Tasa Usada', key: 'tasa_cambio_usada', width: 15 },
      { header: 'Ganancia USD', key: 'ganancia_usd', width: 15 },
      { header: 'Notas', key: 'notas', width: 30 }
    ];

    hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hoja.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2E7D32' }
    };

    ventas.rows.forEach(v => hoja.addRow(v));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=ventas_maracumango.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exportando Excel:', err.message);
    res.status(500).json({ mensaje: 'Error exportando a Excel' });
  }
};

// Exportar ventas a PDF
const exportarVentasPDF = async (req, res) => {
  const { fecha_inicio, fecha_fin } = req.query;

  try {
    const params = [];
    let filtro = 'WHERE v.tipo_pago != \'anulada\'';
    let contador = 1;

    if (fecha_inicio) {
      filtro += ` AND DATE(v.creado_en) >= $${contador}`;
      params.push(fecha_inicio);
      contador++;
    }
    if (fecha_fin) {
      filtro += ` AND DATE(v.creado_en) <= $${contador}`;
      params.push(fecha_fin);
      contador++;
    }

    const ventas = await pool.query(
      `SELECT
        v.id,
        TO_CHAR(v.creado_en, 'DD/MM/YYYY HH24:MI') AS fecha,
        u.nombre AS cajero,
        v.total_usd,
        v.total_pagado,
        v.moneda_pago,
        v.tipo_pago,
        cb.nombre_banco,
        v.tasa_cambio_usada,
        SUM(iv.ganancia_usd) AS ganancia_usd
       FROM ventas v
       LEFT JOIN usuarios u ON v.usuario_id = u.id
       LEFT JOIN cuentas_bancarias cb ON v.cuenta_bancaria_id = cb.id
       LEFT JOIN items_venta iv ON iv.venta_id = v.id
       ${filtro}
       GROUP BY v.id, u.nombre, cb.nombre_banco
       ORDER BY v.creado_en DESC`,
      params
    );

    const totales = await pool.query(
      `SELECT
        COUNT(v.id) AS total_ventas,
        COALESCE(SUM(v.total_usd), 0) AS total_usd,
        COALESCE(SUM(iv.ganancia_usd), 0) AS total_ganancias
       FROM ventas v
       LEFT JOIN items_venta iv ON iv.venta_id = v.id
       ${filtro}`,
      params
    );

    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=ventas_maracumango.pdf');
    doc.pipe(res);

    // Encabezado
    doc.fontSize(20).fillColor('#2E7D32').text('🥭 Maracu Mango', { align: 'center' });
    doc.fontSize(13).fillColor('#333').text('Reporte de Ventas', { align: 'center' });

    if (fecha_inicio || fecha_fin) {
      doc.fontSize(10).fillColor('#666').text(
        `Período: ${fecha_inicio || 'inicio'} al ${fecha_fin || 'hoy'}`,
        { align: 'center' }
      );
    }

    doc.moveDown();

    // Resumen
    const t = totales.rows[0];
    doc.fontSize(11).fillColor('#000');
    doc.text(`Total de ventas: ${t.total_ventas}`);
    doc.text(`Total ingresos: $${parseFloat(t.total_usd).toFixed(2)} USD`);
    doc.text(`Total ganancias: $${parseFloat(t.total_ganancias).toFixed(2)} USD`);
    doc.moveDown();

    // Tabla
    doc.fontSize(9).fillColor('#2E7D32').font('Helvetica-Bold');
    doc.text('#   Fecha              Cajero              Total USD   Moneda  Tipo Pago     Ganancia');
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke('#2E7D32');
    doc.moveDown(0.3);

    doc.font('Helvetica').fillColor('#333');
    ventas.rows.forEach((v) => {
      const linea = `${String(v.id).padEnd(4)} ${v.fecha.padEnd(18)} ${(v.cajero || '').substring(0, 18).padEnd(20)} $${parseFloat(v.total_usd).toFixed(2).padEnd(10)} ${v.moneda_pago.padEnd(8)} ${v.tipo_pago.padEnd(14)} $${parseFloat(v.ganancia_usd || 0).toFixed(2)}`;
      doc.text(linea);
    });

    doc.end();
  } catch (err) {
    console.error('Error exportando PDF:', err.message);
    res.status(500).json({ mensaje: 'Error exportando a PDF' });
  }
};

module.exports = {
  resumenGeneral,
  ventasPorDia,
  reporteInventario,
  exportarVentasExcel,
  exportarVentasPDF
};