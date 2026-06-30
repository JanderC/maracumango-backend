const pool = require('../../config/db');
const { cloudinary } = require('../../config/cloudinary');

// Sanitiza valores numéricos — convierte '' o null a null
const num = (val) => {
  if (val === '' || val === null || val === undefined) return null;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? null : parsed;
};

const bool = (val) => {
  if (val === 'true' || val === true) return true;
  if (val === 'false' || val === false) return false;
  return false;
};

// Calcula el precio final en COP (manual o por porcentaje de ganancia)
const calcularPrecioFinalCop = (costo_unitario_cop, porcentaje_ganancia, precio_manual_cop, usar_precio_manual) => {
  if (usar_precio_manual && precio_manual_cop) {
    return parseFloat(parseFloat(precio_manual_cop).toFixed(2));
  }
  const costo = parseFloat(costo_unitario_cop) || 0;
  const porcentaje = parseFloat(porcentaje_ganancia) || 0;
  return parseFloat((costo + (costo * porcentaje / 100)).toFixed(2));
};

// Obtiene la tasa COP activa más reciente (tasas_cambio.tasa_por_usd = cuántos COP equivalen a 1 USD)
const obtenerTasaCopActiva = async () => {
  const resultado = await pool.query(
    `SELECT * FROM tasas_cambio WHERE moneda = 'COP' ORDER BY actualizado_en DESC LIMIT 1`
  );
  return resultado.rows[0] || null;
};

// Convierte un monto en COP a USD usando la tasa indicada (COP por USD)
const copAUsd = (montoCop, tasaPorUsd) => {
  if (montoCop === null || montoCop === undefined || !tasaPorUsd) return 0;
  return parseFloat((parseFloat(montoCop) / parseFloat(tasaPorUsd)).toFixed(2));
};

const obtenerProductos = async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT p.*,
              c.nombre AS categoria,
              i.nombre AS inventario_nombre,
              i.cantidad AS stock_inventario,
              ROUND(
                CASE WHEN p.costo_unitario_cop > 0
                  THEN ((p.precio_final_cop - p.costo_unitario_cop) / p.costo_unitario_cop) * 100
                  ELSE 0
                END, 2
              ) AS porcentaje_ganancia_real
       FROM productos p
       LEFT JOIN categorias c ON p.categoria_id = c.id
       LEFT JOIN inventario i ON p.inventario_id = i.id
       ORDER BY p.creado_en DESC`
    );
    res.json({ productos: resultado.rows });
  } catch (err) {
    console.error('Error obteniendo productos:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const obtenerProductosActivos = async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT p.id, p.nombre, p.descripcion, p.precio_final_cop, p.precio_final_usd,
              p.imagen_url, p.tiene_toppings, p.categoria_id,
              c.nombre AS categoria
       FROM productos p
       LEFT JOIN categorias c ON p.categoria_id = c.id
       WHERE p.activo = true
       ORDER BY c.nombre, p.nombre`
    );
    res.json({ productos: resultado.rows });
  } catch (err) {
    console.error('Error obteniendo productos activos:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const obtenerProducto = async (req, res) => {
  const { id } = req.params;
  try {
    const producto = await pool.query(
      `SELECT p.*,
              c.nombre AS categoria,
              i.nombre AS inventario_nombre,
              i.cantidad AS stock_inventario
       FROM productos p
       LEFT JOIN categorias c ON p.categoria_id = c.id
       LEFT JOIN inventario i ON p.inventario_id = i.id
       WHERE p.id = $1`,
      [id]
    );

    if (producto.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Producto no encontrado' });
    }

    const toppings = await pool.query(
      `SELECT t.id, t.nombre, t.precio_usd, t.precio_bs, t.precio_cop
       FROM toppings t
       INNER JOIN producto_toppings pt ON t.id = pt.topping_id
       WHERE pt.producto_id = $1 AND t.activo = true`,
      [id]
    );

    res.json({
      producto: { ...producto.rows[0], toppings: toppings.rows }
    });
  } catch (err) {
    console.error('Error obteniendo producto:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const crearProducto = async (req, res) => {
  const {
    nombre, descripcion, categoria_id, inventario_id,
    costo_unitario_cop, porcentaje_ganancia, precio_manual_cop,
    usar_precio_manual, tiene_toppings, toppings_ids
  } = req.body;

  try {
    if (!nombre) {
      return res.status(400).json({ mensaje: 'El nombre es requerido' });
    }
    if (!costo_unitario_cop || costo_unitario_cop === '') {
      return res.status(400).json({ mensaje: 'El costo unitario (COP) es requerido' });
    }

    // La tasa COP es obligatoria para poder derivar los campos en USD
    const tasaCop = await obtenerTasaCopActiva();
    if (!tasaCop) {
      return res.status(400).json({ mensaje: 'Debes cargar una tasa COP antes de crear productos' });
    }

    const usarManual = bool(usar_precio_manual);
    const tieneToppings = bool(tiene_toppings);
    const costoCopNum = num(costo_unitario_cop);
    const porcentajeNum = num(porcentaje_ganancia) || 0;
    const precioManualCopNum = num(precio_manual_cop);
    const categoriaNum = num(categoria_id);
    const inventarioNum = num(inventario_id);

    const precio_final_cop = calcularPrecioFinalCop(costoCopNum, porcentajeNum, precioManualCopNum, usarManual);
    const tasaPorUsd = parseFloat(tasaCop.tasa_por_usd);

    // Derivados en USD (congelados con la tasa de este momento)
    const costo_unitario = copAUsd(costoCopNum, tasaPorUsd);
    const precio_manual = usarManual ? copAUsd(precioManualCopNum, tasaPorUsd) : null;
    const precio_final_usd = copAUsd(precio_final_cop, tasaPorUsd);

    // Imagen subida a Cloudinary — usar URL y public_id del archivo procesado
    let imagen_url = null;
    let imagen_public_id = null;

    if (req.file) {
      imagen_url = req.file.path;         // URL completa de Cloudinary
      imagen_public_id = req.file.filename; // public_id en Cloudinary
    }

    const resultado = await pool.query(
  `INSERT INTO productos
    (nombre, descripcion, categoria_id, inventario_id,
     costo_unitario_cop, porcentaje_ganancia, precio_manual_cop, usar_precio_manual,
     precio_final_cop, tasa_cambio_usada,
     costo_unitario, precio_manual, precio_final_usd, precio_usd,
     imagen_url, imagen_public_id, tiene_toppings)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
   RETURNING *`,
  [
    nombre,
    descripcion || null,
    categoriaNum,
    inventarioNum,
    costoCopNum,
    porcentajeNum,
    precioManualCopNum,
    usarManual,
    precio_final_cop,
    tasaPorUsd,
    costo_unitario,
    precio_manual,
    precio_final_usd,
    precio_final_usd,   // mismo valor para precio_usd
    imagen_url,
    imagen_public_id,
    tieneToppings
  ]
);

    const producto = resultado.rows[0];

    // Asociar toppings
    if (tieneToppings && toppings_ids) {
      const ids = Array.isArray(toppings_ids) ? toppings_ids : JSON.parse(toppings_ids);
      for (const topping_id of ids) {
        await pool.query(
          'INSERT INTO producto_toppings (producto_id, topping_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [producto.id, topping_id]
        );
      }
    }

    res.status(201).json({ mensaje: 'Producto creado exitosamente', producto });
  } catch (err) {
    console.error('Error creando producto:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor', detalle: err.message });
  }
};

const actualizarProducto = async (req, res) => {
  const { id } = req.params;
  const {
    nombre, descripcion, categoria_id, inventario_id,
    costo_unitario_cop, porcentaje_ganancia, precio_manual_cop,
    usar_precio_manual, tiene_toppings, toppings_ids
  } = req.body;

  try {
    const existe = await pool.query('SELECT * FROM productos WHERE id = $1', [id]);
    if (existe.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Producto no encontrado' });
    }

    const productoActual = existe.rows[0];

    // La tasa COP es obligatoria para poder derivar los campos en USD
    const tasaCop = await obtenerTasaCopActiva();
    if (!tasaCop) {
      return res.status(400).json({ mensaje: 'Debes cargar una tasa COP antes de actualizar productos' });
    }
    const tasaPorUsd = parseFloat(tasaCop.tasa_por_usd);

    const usarManual = usar_precio_manual !== undefined ? bool(usar_precio_manual) : productoActual.usar_precio_manual;
    const tieneToppings = tiene_toppings !== undefined ? bool(tiene_toppings) : productoActual.tiene_toppings;

    const costoCopNum = num(costo_unitario_cop) ?? parseFloat(productoActual.costo_unitario_cop);
    const porcentajeNum = num(porcentaje_ganancia) ?? parseFloat(productoActual.porcentaje_ganancia);
    const precioManualCopNum = num(precio_manual_cop) ?? num(productoActual.precio_manual_cop);
    const categoriaNum = num(categoria_id) ?? num(productoActual.categoria_id);
    const inventarioNum = num(inventario_id) ?? num(productoActual.inventario_id);

    const precio_final_cop = calcularPrecioFinalCop(costoCopNum, porcentajeNum, precioManualCopNum, usarManual);

    // Derivados en USD (recalculados y congelados con la tasa vigente en este momento)
    const costo_unitario = copAUsd(costoCopNum, tasaPorUsd);
    const precio_manual = usarManual ? copAUsd(precioManualCopNum, tasaPorUsd) : null;
    const precio_final_usd = copAUsd(precio_final_cop, tasaPorUsd);

    // Manejar imagen
    let imagen_url = productoActual.imagen_url;
    let imagen_public_id = productoActual.imagen_public_id;

    if (req.file) {
      // Eliminar imagen anterior de Cloudinary
      if (productoActual.imagen_public_id) {
        try {
          await cloudinary.uploader.destroy(productoActual.imagen_public_id);
        } catch (e) {
          console.warn('No se pudo eliminar imagen anterior:', e.message);
        }
      }
      imagen_url = req.file.path;
      imagen_public_id = req.file.filename;
    }

    const resultado = await pool.query(
      `UPDATE productos SET
        nombre = COALESCE($1, nombre),
        descripcion = $2,
        categoria_id = $3,
        inventario_id = $4,
        costo_unitario_cop = $5,
        porcentaje_ganancia = $6,
        precio_manual_cop = $7,
        usar_precio_manual = $8,
        precio_final_cop = $9,
        tasa_cambio_usada = $10,
        costo_unitario = $11,
        precio_manual = $12,
        precio_final_usd = $13,
        precio_usd = $14,
        imagen_url = $15,
        imagen_public_id = $16,
        tiene_toppings = $17
       WHERE id = $18
       RETURNING *`,
      [
        nombre || productoActual.nombre,
        descripcion !== undefined ? descripcion : productoActual.descripcion,
        categoriaNum,
        inventarioNum,
        costoCopNum,
        porcentajeNum,
        precioManualCopNum,
        usarManual,
        precio_final_cop,
        tasaPorUsd,
        costo_unitario,
        precio_manual,
        precio_final_usd,
        precio_final_usd,
        imagen_url,
        imagen_public_id,
        tieneToppings,
        id
      ]
    );

    // Actualizar toppings
    if (toppings_ids !== undefined) {
      await pool.query('DELETE FROM producto_toppings WHERE producto_id = $1', [id]);
      const ids = Array.isArray(toppings_ids) ? toppings_ids : JSON.parse(toppings_ids);
      for (const topping_id of ids) {
        await pool.query(
          'INSERT INTO producto_toppings (producto_id, topping_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, topping_id]
        );
      }
    }

    res.json({ mensaje: 'Producto actualizado exitosamente', producto: resultado.rows[0] });
  } catch (err) {
    console.error('Error actualizando producto:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor', detalle: err.message });
  }
};

const toggleActivoProducto = async (req, res) => {
  const { id } = req.params;
  try {
    const resultado = await pool.query(
      'UPDATE productos SET activo = NOT activo WHERE id = $1 RETURNING id, nombre, activo', [id]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Producto no encontrado' });
    }
    const estado = resultado.rows[0].activo ? 'activado' : 'desactivado';
    res.json({ mensaje: `Producto ${estado}`, producto: resultado.rows[0] });
  } catch (err) {
    console.error('Error toggling producto:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const eliminarProducto = async (req, res) => {
  const { id } = req.params;
  try {
    const existe = await pool.query('SELECT * FROM productos WHERE id = $1', [id]);
    if (existe.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Producto no encontrado' });
    }

    if (existe.rows[0].imagen_public_id) {
      try {
        await cloudinary.uploader.destroy(existe.rows[0].imagen_public_id);
      } catch (e) {
        console.warn('No se pudo eliminar imagen de Cloudinary:', e.message);
      }
    }

    await pool.query('DELETE FROM productos WHERE id = $1', [id]);
    res.json({ mensaje: 'Producto eliminado exitosamente' });
  } catch (err) {
    console.error('Error eliminando producto:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

module.exports = {
  obtenerProductos,
  obtenerProductosActivos,
  obtenerProducto,
  crearProducto,
  actualizarProducto,
  toggleActivoProducto,
  eliminarProducto
};