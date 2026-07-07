const pool = require('../../config/db');
const bcrypt = require('bcryptjs');

const obtenerVentas = async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, moneda, tipo_pago } = req.query;

    let query = `
      SELECT v.*,
             u.nombre AS cajero,
             ua.nombre AS anulado_por_nombre,
             cb.nombre_banco,
             cb.titular_cuenta,
             cb.telefono AS banco_telefono,
             cb.moneda AS banco_moneda
      FROM ventas v
      LEFT JOIN usuarios u ON v.usuario_id = u.id
      LEFT JOIN usuarios ua ON v.anulada_por = ua.id
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
              ua.nombre AS anulado_por_nombre,
              cb.nombre_banco,
              cb.numero_cuenta,
              cb.titular_cuenta,
              cb.telefono AS banco_telefono,
              cb.moneda AS banco_moneda
       FROM ventas v
       LEFT JOIN usuarios u ON v.usuario_id = u.id
       LEFT JOIN usuarios ua ON v.anulada_por = ua.id
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
      tasa_cambio_usada, // tasa BS/USD, solo se usa si moneda_pago === 'BS'
      monto_recibido, // solo aplica si tipo_pago === 'efectivo' — en la moneda_pago elegida
      notas,
      items // [{ producto_id, cantidad, toppings_ids: [] }]
    } = req.body;

    if (!moneda_pago || !tipo_pago || !items || items.length === 0) {
      return res.status(400).json({ mensaje: 'Moneda, tipo de pago e items son requeridos' });
    }

    const monedaPago = moneda_pago.toUpperCase();

    if (!['USD', 'BS', 'COP'].includes(monedaPago)) {
      return res.status(400).json({ mensaje: 'Moneda inválida. Use USD, BS o COP' });
    }

    if (!['efectivo', 'transferencia'].includes(tipo_pago)) {
      return res.status(400).json({ mensaje: 'Tipo de pago inválido. Use efectivo o transferencia' });
    }

    if (tipo_pago === 'transferencia' && !cuenta_bancaria_id) {
      return res.status(400).json({ mensaje: 'Debe seleccionar una cuenta bancaria para transferencia' });
    }

    if (tipo_pago === 'efectivo' && (monto_recibido === undefined || monto_recibido === null || monto_recibido === '')) {
      return res.status(400).json({ mensaje: 'Debe indicar el monto recibido en efectivo' });
    }

    if (monedaPago === 'BS' && !tasa_cambio_usada) {
      return res.status(400).json({ mensaje: 'Debe proporcionar la tasa de cambio (BS/USD) para pagos en BS' });
    }

    // Tasa COP activa — siempre se necesita porque precio_final_cop es la fuente de verdad
    const tasaCopRow = await client.query(
      `SELECT * FROM tasas_cambio WHERE moneda = 'COP' ORDER BY actualizado_en DESC LIMIT 1`
    );
    if (tasaCopRow.rows.length === 0) {
      return res.status(400).json({ mensaje: 'No hay tasa COP registrada. Cárgala en Tasas de cambio antes de vender' });
    }
    const tasaCopPorUsd = parseFloat(tasaCopRow.rows[0].tasa_por_usd);

    await client.query('BEGIN');

    let total_cop = 0;
    const itemsProcesados = [];

    // Procesar cada item
    for (const item of items) {
      const { producto_id, cantidad, toppings_ids } = item;

      if (!producto_id || !cantidad || cantidad <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ mensaje: 'Cada item debe tener producto_id y cantidad válida' });
      }

      // Obtener producto — precio_final_cop es la fuente de verdad real
      const producto = await client.query(
        'SELECT id, nombre, precio_final_cop, costo_unitario_cop FROM productos WHERE id = $1 AND COALESCE(activo, true) = true',
        [producto_id]
      );

      if (producto.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ mensaje: `Producto ${producto_id} no encontrado o inactivo` });
      }

      const prod = producto.rows[0];
      let precio_unitario_cop = parseFloat(prod.precio_final_cop);
      let costo_unitario_cop = parseFloat(prod.costo_unitario_cop);

      // Sumar toppings al precio (toppings ya tienen precio_cop propio)
      let toppings_procesados = [];
      if (toppings_ids && toppings_ids.length > 0) {
        for (const topping_id of toppings_ids) {
          const topping = await client.query(
            'SELECT id, nombre, precio_cop FROM toppings WHERE id = $1 AND COALESCE(activo, true) = true',
            [topping_id]
          );
          if (topping.rows.length > 0) {
            const precioToppingCop = parseFloat(topping.rows[0].precio_cop) || 0;
            precio_unitario_cop += precioToppingCop;
            toppings_procesados.push({
              topping_id,
              precio_cop: precioToppingCop,
              precio_usd: parseFloat((precioToppingCop / tasaCopPorUsd).toFixed(2))
            });
          }
        }
      }

      const subtotal_cop = parseFloat((precio_unitario_cop * cantidad).toFixed(2));
      const ganancia_cop = parseFloat(((precio_unitario_cop - costo_unitario_cop) * cantidad).toFixed(2));
      total_cop += subtotal_cop;

      // Derivados en USD (para mantener las columnas _usd existentes en items_venta)
      const precio_unitario_usd = parseFloat((precio_unitario_cop / tasaCopPorUsd).toFixed(2));
      const costo_unitario_usd = parseFloat((costo_unitario_cop / tasaCopPorUsd).toFixed(2));
      const subtotal_usd = parseFloat((subtotal_cop / tasaCopPorUsd).toFixed(2));
      const ganancia_usd = parseFloat((ganancia_cop / tasaCopPorUsd).toFixed(2));

      itemsProcesados.push({
        producto_id,
        cantidad,
        precio_unitario_usd,
        costo_unitario_usd,
        subtotal_usd,
        ganancia_usd,
        precio_unitario_cop,
        costo_unitario_cop,
        subtotal_cop,
        ganancia_cop,
        toppings: toppings_procesados
      });
    }

    total_cop = parseFloat(total_cop.toFixed(2));
    const total_usd = parseFloat((total_cop / tasaCopPorUsd).toFixed(2));

    // Calcular total en la moneda de pago elegida
    let total_pagado;
    if (monedaPago === 'COP') {
      total_pagado = total_cop;
    } else if (monedaPago === 'USD') {
      total_pagado = total_usd;
    } else { // BS — se cruza vía USD con la tasa BS/USD vigente
      total_pagado = parseFloat((total_usd * parseFloat(tasa_cambio_usada)).toFixed(2));
    }

    // Validar y calcular el vuelto (solo aplica a pagos en efectivo)
    let montoRecibidoNum = null;
    let vuelto = null;
    if (tipo_pago === 'efectivo') {
      montoRecibidoNum = parseFloat(monto_recibido);
      if (isNaN(montoRecibidoNum) || montoRecibidoNum < 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ mensaje: 'El monto recibido no es válido' });
      }
      // Tolerancia mínima por redondeos de punto flotante
      if (montoRecibidoNum < total_pagado - 0.01) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          mensaje: `El monto recibido (${montoRecibidoNum}) es insuficiente. Total a cobrar: ${total_pagado} ${monedaPago}`
        });
      }
      vuelto = parseFloat((montoRecibidoNum - total_pagado).toFixed(2));
    }

    // Insertar venta
    const ventaResult = await client.query(
      `INSERT INTO ventas
        (usuario_id, total_usd, total_cop, total_pagado, moneda_pago, tipo_pago, cuenta_bancaria_id, tasa_cambio_usada, monto_recibido, vuelto, notas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        req.usuario.id,
        total_usd,
        total_cop,
        total_pagado,
        monedaPago,
        tipo_pago,
        cuenta_bancaria_id || null,
        monedaPago === 'BS' ? tasa_cambio_usada : tasaCopPorUsd,
        montoRecibidoNum,
        vuelto,
        notas || null
      ]
    );

    const venta = ventaResult.rows[0];

    // Insertar items y sus toppings
    for (const item of itemsProcesados) {
      const itemResult = await client.query(
        `INSERT INTO items_venta
          (venta_id, producto_id, cantidad,
           precio_unitario_usd, costo_unitario_usd, subtotal_usd, ganancia_usd,
           precio_unitario_cop, costo_unitario_cop, subtotal_cop, ganancia_cop)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          venta.id,
          item.producto_id,
          item.cantidad,
          item.precio_unitario_usd,
          item.costo_unitario_usd,
          item.subtotal_usd,
          item.ganancia_usd,
          item.precio_unitario_cop,
          item.costo_unitario_cop,
          item.subtotal_cop,
          item.ganancia_cop
        ]
      );

      const item_venta_id = itemResult.rows[0].id;

      for (const topping of item.toppings) {
        await client.query(
          `INSERT INTO items_venta_toppings (item_venta_id, topping_id, precio_usd, precio_cop)
           VALUES ($1, $2, $3, $4)`,
          [item_venta_id, topping.topping_id, topping.precio_usd, topping.precio_cop]
        );
      }
    }

    await client.query('COMMIT');

    // ── Descuento de inventario (fuera del commit principal para no bloquear la venta) ──
    // Se procesa en una transacción separada; si falla no revierte la venta.
    // Stock negativo se permite pero genera alerta en stock_alertas.
    try {
      const clientInv = await pool.connect();
      try {
        await clientInv.query('BEGIN');

        for (const item of itemsProcesados) {
          // Receta del producto
          const recetaProducto = await clientInv.query(
            `SELECT pi.*, i.nombre AS insumo_nombre
             FROM producto_insumos pi
             JOIN inventario i ON pi.inventario_id = i.id
             WHERE pi.producto_id = $1`,
            [item.producto_id]
          );

          for (const ins of recetaProducto.rows) {
            const totalDescontar = parseFloat(ins.cantidad_requerida) * item.cantidad;
            const stockRes = await clientInv.query(
              `UPDATE inventario SET cantidad = cantidad - $1 WHERE id = $2 RETURNING cantidad, nombre`,
              [totalDescontar, ins.inventario_id]
            );
            const stockResultante = parseFloat(stockRes.rows[0].cantidad);
            if (stockResultante < 0) {
              await clientInv.query(
                `INSERT INTO stock_alertas (venta_id, inventario_id, inventario_nombre, cantidad_descontada, stock_resultante, mensaje)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                  venta.id, ins.inventario_id, stockRes.rows[0].nombre,
                  totalDescontar, stockResultante,
                  `Stock insuficiente al vender producto #${item.producto_id} × ${item.cantidad}. Stock resultante: ${stockResultante}`
                ]
              );
            }
          }

          // Receta de cada topping del item
          for (const topping of item.toppings) {
            const recetaTopping = await clientInv.query(
              `SELECT ti.*, i.nombre AS insumo_nombre
               FROM topping_insumos ti
               JOIN inventario i ON ti.inventario_id = i.id
               WHERE ti.topping_id = $1`,
              [topping.topping_id]
            );

            for (const ins of recetaTopping.rows) {
              const totalDescontar = parseFloat(ins.cantidad_requerida) * item.cantidad;
              const stockRes = await clientInv.query(
                `UPDATE inventario SET cantidad = cantidad - $1 WHERE id = $2 RETURNING cantidad, nombre`,
                [totalDescontar, ins.inventario_id]
              );
              const stockResultante = parseFloat(stockRes.rows[0].cantidad);
              if (stockResultante < 0) {
                await clientInv.query(
                  `INSERT INTO stock_alertas (venta_id, inventario_id, inventario_nombre, cantidad_descontada, stock_resultante, mensaje)
                   VALUES ($1, $2, $3, $4, $5, $6)`,
                  [
                    venta.id, ins.inventario_id, stockRes.rows[0].nombre,
                    totalDescontar, stockResultante,
                    `Stock insuficiente al descontar topping #${topping.topping_id} × ${item.cantidad}. Stock resultante: ${stockResultante}`
                  ]
                );
              }
            }
          }
        }

        await clientInv.query('COMMIT');
      } catch (eInv) {
        await clientInv.query('ROLLBACK');
        console.error('Error descontando inventario (venta registrada igual):', eInv.message);
      } finally {
        clientInv.release();
      }
    } catch (ePool) {
      console.error('No se pudo conectar para descontar inventario:', ePool.message);
    }

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
  const { motivo, contrasena } = req.body;

  try {
    if (!motivo || !motivo.trim()) {
      return res.status(400).json({ mensaje: 'Debes indicar el motivo de la anulación' });
    }
    if (!contrasena) {
      return res.status(400).json({ mensaje: 'Debes confirmar con tu contraseña para anular' });
    }

    // Verificar la contraseña del admin logueado (reautenticación, no solo el token)
    const usuarioRes = await pool.query('SELECT contrasena FROM usuarios WHERE id = $1', [req.usuario.id]);
    if (usuarioRes.rows.length === 0) {
      return res.status(401).json({ mensaje: 'Usuario no encontrado' });
    }
    const contrasenaValida = await bcrypt.compare(contrasena, usuarioRes.rows[0].contrasena);
    if (!contrasenaValida) {
      return res.status(401).json({ mensaje: 'Contraseña incorrecta. La venta no fue anulada' });
    }

    const existe = await pool.query('SELECT * FROM ventas WHERE id = $1', [id]);
    if (existe.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Venta no encontrada' });
    }
    if (existe.rows[0].anulada) {
      return res.status(400).json({ mensaje: 'Esta venta ya había sido anulada anteriormente' });
    }

    const resultado = await pool.query(
      `UPDATE ventas SET
        anulada = true,
        motivo_anulacion = $1,
        anulada_en = NOW(),
        anulada_por = $2
       WHERE id = $3
       RETURNING *`,
      [motivo.trim(), req.usuario.id, id]
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