const pool = require('../../config/db');

const obtenerVentas = async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, moneda, tipo_pago } = req.query;

    let query = `
      SELECT v.*,
             u.nombre AS cajero,
             cb.nombre_banco,
             cb.titular_cuenta,
             cb.telefono AS banco_telefono,
             cb.moneda AS banco_moneda
      FROM ventas v
      LEFT JOIN usuarios u ON v.usuario_id = u.id
      LEFT JOIN cuentas_bancarias cb ON v.cuenta_bancaria_id = cb.id
      WHERE 1=1
    `;

    const params = [];
    let contador = 1;

    if (fecha_inicio) {
      query += ` AND DATE(v.creado_en) >= $${contador}`;
      params.push(fecha_inicio);
      contador++;
    }

    if (fecha_fin) {
      query += ` AND DATE(v.creado_en) <= $${contador}`;
      params.push(fecha_fin);
      contador++;
    }

    if (moneda) {
      query += ` AND v.moneda_pago = $${contador}`;
      params.push(moneda.toUpperCase());
      contador++;
    }

    if (tipo_pago) {
      query += ` AND v.tipo_pago = $${contador}`;
      params.push(tipo_pago);
      contador++;
    }

    query += ' ORDER BY v.creado_en DESC';

    const resultado = await pool.query(query, params);
    res.json({ ventas: resultado.rows });
  } catch (err) {
    console.error('Error obteniendo ventas:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const obtenerVenta = async (req, res) => {
  const { id } = req.params;

  try {
    const venta = await pool.query(
      `SELECT v.*,
              u.nombre AS cajero,
              cb.nombre_banco,
              cb.numero_cuenta,
              cb.titular_cuenta,
              cb.telefono AS banco_telefono,
              cb.moneda AS banco_moneda
       FROM ventas v
       LEFT JOIN usuarios u ON v.usuario_id = u.id
       LEFT JOIN cuentas_bancarias cb ON v.cuenta_bancaria_id = cb.id
       WHERE v.id = $1`,
      [id]
    );

    if (venta.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Venta no encontrada' });
    }

    const items = await pool.query(
      `SELECT iv.*,
              p.nombre AS producto_nombre,
              p.imagen_url AS producto_imagen
       FROM items_venta iv
       LEFT JOIN productos p ON iv.producto_id = p.id
       WHERE iv.venta_id = $1`,
      [id]
    );

    // Obtener toppings por cada item
    const itemsConToppings = await Promise.all(
      items.rows.map(async (item) => {
        const toppings = await pool.query(
          `SELECT ivt.*, t.nombre AS topping_nombre
           FROM items_venta_toppings ivt
           LEFT JOIN toppings t ON ivt.topping_id = t.id
           WHERE ivt.item_venta_id = $1`,
          [item.id]
        );
        return { ...item, toppings: toppings.rows };
      })
    );

    res.json({
      venta: {
        ...venta.rows[0],
        items: itemsConToppings
      }
    });
  } catch (err) {
    console.error('Error obteniendo venta:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const crearVenta = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      moneda_pago,
      tipo_pago,
      cuenta_bancaria_id,
      tasa_cambio_usada,
      notas,
      items // [{ producto_id, cantidad, toppings_ids: [] }]
    } = req.body;

    if (!moneda_pago || !tipo_pago || !items || items.length === 0) {
      return res.status(400).json({ mensaje: 'Moneda, tipo de pago e items son requeridos' });
    }

    if (!['USD', 'BS', 'COP'].includes(moneda_pago.toUpperCase())) {
      return res.status(400).json({ mensaje: 'Moneda inválida. Use USD, BS o COP' });
    }

    if (!['efectivo', 'transferencia'].includes(tipo_pago)) {
      return res.status(400).json({ mensaje: 'Tipo de pago inválido. Use efectivo o transferencia' });
    }

    if (tipo_pago === 'transferencia' && !cuenta_bancaria_id) {
      return res.status(400).json({ mensaje: 'Debe seleccionar una cuenta bancaria para transferencia' });
    }

    if (moneda_pago !== 'USD' && !tasa_cambio_usada) {
      return res.status(400).json({ mensaje: 'Debe proporcionar la tasa de cambio para pagos en BS o COP' });
    }

    await client.query('BEGIN');

    let total_usd = 0;
    const itemsProcesados = [];

    // Procesar cada item
    for (const item of items) {
      const { producto_id, cantidad, toppings_ids } = item;

      if (!producto_id || !cantidad || cantidad <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ mensaje: 'Cada item debe tener producto_id y cantidad válida' });
      }

      // Obtener producto
      const producto = await client.query(
        'SELECT id, nombre, precio_final_usd, costo_unitario FROM productos WHERE id = $1 AND activo = true',
        [producto_id]
      );

      if (producto.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ mensaje: `Producto ${producto_id} no encontrado o inactivo` });
      }

      const prod = producto.rows[0];
      let precio_unitario = parseFloat(prod.precio_final_usd);
      let costo_unitario = parseFloat(prod.costo_unitario);

      // Sumar toppings al precio
      let toppings_procesados = [];
      if (toppings_ids && toppings_ids.length > 0) {
        for (const topping_id of toppings_ids) {
          const topping = await client.query(
            'SELECT id, nombre, precio_usd FROM toppings WHERE id = $1 AND activo = true',
            [topping_id]
          );
          if (topping.rows.length > 0) {
            precio_unitario += parseFloat(topping.rows[0].precio_usd);
            toppings_procesados.push({
              topping_id,
              precio_usd: parseFloat(topping.rows[0].precio_usd)
            });
          }
        }
      }

      const subtotal_usd = parseFloat((precio_unitario * cantidad).toFixed(2));
      const ganancia_usd = parseFloat(((precio_unitario - costo_unitario) * cantidad).toFixed(2));
      total_usd += subtotal_usd;

      itemsProcesados.push({
        producto_id,
        cantidad,
        precio_unitario_usd: precio_unitario,
        costo_unitario_usd: costo_unitario,
        subtotal_usd,
        ganancia_usd,
        toppings: toppings_procesados
      });
    }

    total_usd = parseFloat(total_usd.toFixed(2));

    // Calcular total en moneda de pago
    let total_pagado = total_usd;
    if (moneda_pago === 'BS') {
      total_pagado = parseFloat((total_usd * parseFloat(tasa_cambio_usada)).toFixed(2));
    } else if (moneda_pago === 'COP') {
      total_pagado = parseFloat((total_usd * parseFloat(tasa_cambio_usada)).toFixed(2));
    }

    // Insertar venta
    const ventaResult = await client.query(
      `INSERT INTO ventas
        (usuario_id, total_usd, total_pagado, moneda_pago, tipo_pago, cuenta_bancaria_id, tasa_cambio_usada, notas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.usuario.id,
        total_usd,
        total_pagado,
        moneda_pago.toUpperCase(),
        tipo_pago,
        cuenta_bancaria_id || null,
        tasa_cambio_usada || null,
        notas || null
      ]
    );

    const venta = ventaResult.rows[0];

    // Insertar items y sus toppings
    for (const item of itemsProcesados) {
      const itemResult = await client.query(
        `INSERT INTO items_venta
          (venta_id, producto_id, cantidad, precio_unitario_usd, costo_unitario_usd, subtotal_usd, ganancia_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          venta.id,
          item.producto_id,
          item.cantidad,
          item.precio_unitario_usd,
          item.costo_unitario_usd,
          item.subtotal_usd,
          item.ganancia_usd
        ]
      );

      const item_venta_id = itemResult.rows[0].id;

      for (const topping of item.toppings) {
        await client.query(
          `INSERT INTO items_venta_toppings (item_venta_id, topping_id, precio_usd)
           VALUES ($1, $2, $3)`,
          [item_venta_id, topping.topping_id, topping.precio_usd]
        );
      }
    }

    await client.query('COMMIT');

    // Retornar venta completa
    const ventaCompleta = await obtenerVentaCompleta(venta.id);

    res.status(201).json({
      mensaje: 'Venta registrada exitosamente',
      venta: ventaCompleta
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creando venta:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  } finally {
    client.release();
  }
};

// Helper interno para obtener venta completa después de crear
const obtenerVentaCompleta = async (venta_id) => {
  const venta = await pool.query(
    `SELECT v.*,
            u.nombre AS cajero,
            cb.nombre_banco,
            cb.numero_cuenta,
            cb.titular_cuenta,
            cb.telefono AS banco_telefono,
            cb.moneda AS banco_moneda
     FROM ventas v
     LEFT JOIN usuarios u ON v.usuario_id = u.id
     LEFT JOIN cuentas_bancarias cb ON v.cuenta_bancaria_id = cb.id
     WHERE v.id = $1`,
    [venta_id]
  );

  const items = await pool.query(
    `SELECT iv.*, p.nombre AS producto_nombre, p.imagen_url AS producto_imagen
     FROM items_venta iv
     LEFT JOIN productos p ON iv.producto_id = p.id
     WHERE iv.venta_id = $1`,
    [venta_id]
  );

  const itemsConToppings = await Promise.all(
    items.rows.map(async (item) => {
      const toppings = await pool.query(
        `SELECT ivt.*, t.nombre AS topping_nombre
         FROM items_venta_toppings ivt
         LEFT JOIN toppings t ON ivt.topping_id = t.id
         WHERE ivt.item_venta_id = $1`,
        [item.id]
      );
      return { ...item, toppings: toppings.rows };
    })
  );

  return { ...venta.rows[0], items: itemsConToppings };
};

const anularVenta = async (req, res) => {
  const { id } = req.params;
  const { motivo } = req.body;

  try {
    const existe = await pool.query('SELECT * FROM ventas WHERE id = $1', [id]);
    if (existe.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Venta no encontrada' });
    }

    const resultado = await pool.query(
      `UPDATE ventas SET
        tipo_pago = 'anulada',
        notas = CONCAT(COALESCE(notas, ''), ' | ANULADA: ', $1)
       WHERE id = $2
       RETURNING *`,
      [motivo || 'Sin motivo', id]
    );

    res.json({
      mensaje: 'Venta anulada exitosamente',
      venta: resultado.rows[0]
    });
  } catch (err) {
    console.error('Error anulando venta:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

module.exports = {
  obtenerVentas,
  obtenerVenta,
  crearVenta,
  anularVenta
};