const pool = require('../../config/db');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// ── Resumen general ─────────────────────────────────────────────────────────
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

    // Totales en COP (nativo) y USD (derivado)
    // Nota: las ganancias se agregan en una subconsulta agrupada por venta_id
    // ANTES de unir con ventas, para evitar que el JOIN con items_venta
    // multiplique (fan-out) el total_cop/total_usd de la venta según su
    // cantidad de productos.
    const totales = await pool.query(
      `SELECT
        COUNT(DISTINCT v.id)                        AS total_ventas,
        COALESCE(SUM(v.total_cop), 0)               AS total_ingresos_cop,
        COALESCE(SUM(v.total_usd), 0)                AS total_ingresos_usd,
        COALESCE(SUM(g.ganancia_cop), 0)            AS total_ganancias_cop,
        COALESCE(SUM(g.ganancia_usd), 0)            AS total_ganancias_usd,
        COALESCE(AVG(v.total_cop), 0)               AS ticket_promedio_cop,
        COALESCE(AVG(v.total_usd), 0)               AS ticket_promedio_usd
       FROM ventas v
       LEFT JOIN (
         SELECT venta_id, SUM(ganancia_cop) AS ganancia_cop, SUM(ganancia_usd) AS ganancia_usd
         FROM items_venta
         GROUP BY venta_id
       ) g ON g.venta_id = v.id
       WHERE COALESCE(v.anulada, false) = false ${filtroFecha}`,
      params
    );

    // Ventas por moneda
    const filtroSinAlias = filtroFecha.replace(/v\./g, '');
    const porMoneda = await pool.query(
      `SELECT moneda_pago,
              COUNT(*) AS cantidad,
              SUM(total_pagado) AS total_pagado,
              SUM(total_cop)    AS total_cop,
              SUM(total_usd)    AS total_usd
       FROM ventas
       WHERE COALESCE(anulada, false) = false ${filtroSinAlias}
       GROUP BY moneda_pago
       ORDER BY cantidad DESC`,
      params
    );

    // Ventas por tipo de pago
    const porTipoPago = await pool.query(
      `SELECT tipo_pago,
              COUNT(*) AS cantidad,
              SUM(total_cop) AS total_cop,
              SUM(total_usd) AS total_usd
       FROM ventas
       WHERE COALESCE(anulada, false) = false ${filtroSinAlias}
       GROUP BY tipo_pago`,
      params
    );

    // Productos más vendidos (COP nativo)
    const masVendidos = await pool.query(
      `SELECT p.nombre,
              p.codigo,
              SUM(iv.cantidad)     AS unidades_vendidas,
              SUM(iv.subtotal_cop) AS total_cop,
              SUM(iv.subtotal_usd) AS total_usd,
              SUM(iv.ganancia_cop) AS ganancia_cop,
              SUM(iv.ganancia_usd) AS ganancia_usd
       FROM items_venta iv
       LEFT JOIN productos p ON iv.producto_id = p.id
       LEFT JOIN ventas v ON iv.venta_id = v.id
       WHERE COALESCE(v.anulada, false) = false ${filtroFecha}
       GROUP BY p.id, p.nombre, p.codigo
       ORDER BY unidades_vendidas DESC
       LIMIT 10`,
      params
    );

    // Alertas de stock pendientes
    const alertasStock = await pool.query(
      `SELECT COUNT(*) AS total FROM stock_alertas WHERE resuelta = false`
    );

    res.json({
      resumen: totales.rows[0],
      por_moneda: porMoneda.rows,
      por_tipo_pago: porTipoPago.rows,
      productos_mas_vendidos: masVendidos.rows,
      alertas_stock: parseInt(alertasStock.rows[0].total)
    });
  } catch (err) {
    console.error('Error generando resumen:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// ── Ventas por día ───────────────────────────────────────────────────────────
const ventasPorDia = async (req, res) => {
  const { fecha_inicio, fecha_fin } = req.query;

  try {
    const params = [];
    let filtro = "WHERE COALESCE(v.anulada, false) = false";
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
        DATE(v.creado_en)        AS fecha,
        COUNT(DISTINCT v.id)     AS total_ventas,
        SUM(v.total_cop)         AS total_cop,
        SUM(v.total_usd)         AS total_usd,
        COALESCE(SUM(g.ganancia_cop), 0) AS ganancia_cop,
        COALESCE(SUM(g.ganancia_usd), 0) AS ganancia_usd
       FROM ventas v
       LEFT JOIN (
         SELECT venta_id, SUM(ganancia_cop) AS ganancia_cop, SUM(ganancia_usd) AS ganancia_usd
         FROM items_venta
         GROUP BY venta_id
       ) g ON g.venta_id = v.id
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

// ── Inventario ───────────────────────────────────────────────────────────────
const reporteInventario = async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT i.*,
              c.nombre AS categoria,
              COALESCE(p.total_productos, 0) AS productos_asociados,
              COALESCE(sa.alertas_pendientes, 0) AS alertas_pendientes
       FROM inventario i
       LEFT JOIN categorias c ON i.categoria_id = c.id
       LEFT JOIN (
         SELECT inventario_id, COUNT(*) AS total_productos
         FROM productos
         GROUP BY inventario_id
       ) p ON p.inventario_id = i.id
       LEFT JOIN (
         SELECT inventario_id, COUNT(*) AS alertas_pendientes
         FROM stock_alertas
         WHERE resuelta = false
         GROUP BY inventario_id
       ) sa ON sa.inventario_id = i.id
       ORDER BY i.nombre ASC`
    );
    res.json({ inventario: resultado.rows });
  } catch (err) {
    console.error('Error reporte inventario:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// ── Exportar Excel ───────────────────────────────────────────────────────────
const exportarVentasExcel = async (req, res) => {
  const { fecha_inicio, fecha_fin } = req.query;

  try {
    const params = [];
    let filtro = "WHERE COALESCE(v.anulada, false) = false";
    let contador = 1;

    if (fecha_inicio) { filtro += ` AND DATE(v.creado_en) >= $${contador}`; params.push(fecha_inicio); contador++; }
    if (fecha_fin)    { filtro += ` AND DATE(v.creado_en) <= $${contador}`; params.push(fecha_fin);    contador++; }

    const ventas = await pool.query(
      `SELECT
        v.id,
        TO_CHAR(v.creado_en, 'DD/MM/YYYY HH24:MI') AS fecha,
        u.nombre        AS cajero,
        v.total_cop,
        v.total_usd,
        v.total_pagado,
        v.moneda_pago,
        v.tipo_pago,
        cb.nombre_banco,
        cb.titular_cuenta,
        v.tasa_cambio_usada,
        v.notas,
        SUM(iv.ganancia_cop) AS ganancia_cop,
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

    hoja.columns = [
      { header: '# Venta',      key: 'id',                width: 10 },
      { header: 'Fecha',        key: 'fecha',             width: 20 },
      { header: 'Cajero',       key: 'cajero',            width: 20 },
      { header: 'Total COP',    key: 'total_cop',         width: 16 },
      { header: 'Total USD',    key: 'total_usd',         width: 14 },
      { header: 'Total Pagado', key: 'total_pagado',      width: 15 },
      { header: 'Moneda',       key: 'moneda_pago',       width: 10 },
      { header: 'Tipo Pago',    key: 'tipo_pago',         width: 15 },
      { header: 'Banco',        key: 'nombre_banco',      width: 20 },
      { header: 'Titular',      key: 'titular_cuenta',    width: 20 },
      { header: 'Tasa Usada',   key: 'tasa_cambio_usada', width: 15 },
      { header: 'Ganancia COP', key: 'ganancia_cop',      width: 16 },
      { header: 'Ganancia USD', key: 'ganancia_usd',      width: 14 },
      { header: 'Notas',        key: 'notas',             width: 30 }
    ];

    hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hoja.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };

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

// ── Exportar PDF ─────────────────────────────────────────────────────────────
const exportarVentasPDF = async (req, res) => {
  const { fecha_inicio, fecha_fin } = req.query;

  try {
    const params = [];
    let filtro = "WHERE COALESCE(v.anulada, false) = false";
    let contador = 1;

    if (fecha_inicio) { filtro += ` AND DATE(v.creado_en) >= $${contador}`; params.push(fecha_inicio); contador++; }
    if (fecha_fin)    { filtro += ` AND DATE(v.creado_en) <= $${contador}`; params.push(fecha_fin);    contador++; }

    const ventas = await pool.query(
      `SELECT
        v.id,
        TO_CHAR(v.creado_en, 'DD/MM/YYYY HH24:MI') AS fecha,
        u.nombre AS cajero,
        v.total_cop,
        v.total_usd,
        v.total_pagado,
        v.moneda_pago,
        v.tipo_pago,
        SUM(iv.ganancia_cop) AS ganancia_cop
       FROM ventas v
       LEFT JOIN usuarios u ON v.usuario_id = u.id
       LEFT JOIN items_venta iv ON iv.venta_id = v.id
       ${filtro}
       GROUP BY v.id, u.nombre
       ORDER BY v.creado_en DESC`,
      params
    );

    const totales = await pool.query(
      `SELECT
        COUNT(DISTINCT v.id)              AS total_ventas,
        COALESCE(SUM(v.total_cop), 0)    AS total_cop,
        COALESCE(SUM(v.total_usd), 0)    AS total_usd,
        COALESCE(SUM(iv.ganancia_cop), 0) AS total_ganancias_cop
       FROM ventas v
       LEFT JOIN items_venta iv ON iv.venta_id = v.id
       ${filtro}`,
      params
    );

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=ventas_maracumango.pdf');
    doc.pipe(res);

    doc.fontSize(20).fillColor('#2E7D32').text('🥭 Maracu Mango', { align: 'center' });
    doc.fontSize(13).fillColor('#333').text('Reporte de Ventas', { align: 'center' });
    if (fecha_inicio || fecha_fin) {
      doc.fontSize(10).fillColor('#666').text(
        `Período: ${fecha_inicio || 'inicio'} al ${fecha_fin || 'hoy'}`, { align: 'center' }
      );
    }
    doc.moveDown();

    const t = totales.rows[0];
    doc.fontSize(11).fillColor('#000');
    doc.text(`Total de ventas: ${t.total_ventas}`);
    doc.text(`Total ingresos COP: $${Number(t.total_cop).toLocaleString('es-CO')}`);
    doc.text(`Total ingresos USD: $${parseFloat(t.total_usd).toFixed(2)}`);
    doc.text(`Total ganancias COP: $${Number(t.total_ganancias_cop).toLocaleString('es-CO')}`);
    doc.moveDown();

    doc.fontSize(9).fillColor('#2E7D32').font('Helvetica-Bold');
    doc.text('#    Fecha              Cajero              Total COP         Moneda   Tipo Pago    Ganancia COP');
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke('#2E7D32');
    doc.moveDown(0.3);

    doc.font('Helvetica').fillColor('#333');
    ventas.rows.forEach(v => {
      const cop = Number(v.total_cop).toLocaleString('es-CO').padEnd(16);
      const gan = Number(v.ganancia_cop || 0).toLocaleString('es-CO');
      const linea = `${String(v.id).padEnd(5)} ${v.fecha.padEnd(18)} ${(v.cajero||'').substring(0,18).padEnd(20)} ${cop} ${v.moneda_pago.padEnd(9)} ${v.tipo_pago.padEnd(13)} ${gan}`;
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