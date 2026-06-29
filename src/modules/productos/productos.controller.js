const pool = require('../../config/db');
const { cloudinary } = require('../../config/cloudinary');

const calcularPrecioFinal = (costo_unitario, porcentaje_ganancia, precio_manual, usar_precio_manual) => {
  if (usar_precio_manual && precio_manual) {
    return parseFloat(precio_manual);
  }
  const costo = parseFloat(costo_unitario);
  const porcentaje = parseFloat(porcentaje_ganancia) || 0;
  return parseFloat((costo + (costo * porcentaje / 100)).toFixed(2));
};

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

const obtenerProductos = async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT p.*,
              c.nombre AS categoria,
              i.nombre AS inventario_nombre,
              i.cantidad AS stock_inventario,
              ROUND(
                CASE WHEN p.costo_unitario > 0
                  THEN ((p.precio_final_usd - p.costo_unitario) / p.costo_unitario) * 100
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
      `SELECT p.id, p.nombre, p.descripcion, p.precio_final_usd,
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
    costo_unitario, porcentaje_ganancia, precio_manual,
    usar_precio_manual, tiene_toppings, toppings_ids
  } = req.body;

  try {
    if (!nombre) {
      return res.status(400).json({ mensaje: 'El nombre es requerido' });
    }
    if (!costo_unitario || costo_unitario === '') {
      return res.status(400).json({ mensaje: 'El costo unitario es requerido' });
    }

    const usarManual = bool(usar_precio_manual);
    const tieneToppings = bool(tiene_toppings);
    const costoNum = num(costo_unitario);
    const porcentajeNum = num(porcentaje_ganancia) || 0;
    const precioManualNum = num(precio_manual);
    const categoriaNum = num(categoria_id);
    const inventarioNum = num(inventario_id);

    const precio_final_usd = calcularPrecioFinal(costoNum, porcentajeNum, precioManualNum, usarManual);

    // Imagen subida a Cloudinary — usar URL y public_id del archivo procesado
    let imagen_url = null;
    let imagen_public_id = null;

    if (req.file) {
      imagen_url = req.file.path;         // URL completa de Cloudinary
      imagen_public_id = req.file.filename; // public_id en Cloudinary
    }

    const resultado = await pool.query(
  `INSERT INTO productos
    (nombre, descripcion, categoria_id, inventario_id, costo_unitario,
     porcentaje_ganancia, precio_manual, usar_precio_manual, precio_final_usd,
     precio_usd, imagen_url, imagen_public_id, tiene_toppings)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
   RETURNING *`,
  [
    nombre,
    descripcion || null,
    categoriaNum,
    inventarioNum,
    costoNum,
    porcentajeNum,
    precioManualNum,
    usarManual,
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
    costo_unitario, porcentaje_ganancia, precio_manual,
    usar_precio_manual, tiene_toppings, toppings_ids
  } = req.body;

  try {
    const existe = await pool.query('SELECT * FROM productos WHERE id = $1', [id]);
    if (existe.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Producto no encontrado' });
    }

    const productoActual = existe.rows[0];

    const usarManual = usar_precio_manual !== undefined ? bool(usar_precio_manual) : productoActual.usar_precio_manual;
    const tieneToppings = tiene_toppings !== undefined ? bool(tiene_toppings) : productoActual.tiene_toppings;

    const costoNum = num(costo_unitario) ?? parseFloat(productoActual.costo_unitario);
    const porcentajeNum = num(porcentaje_ganancia) ?? parseFloat(productoActual.porcentaje_ganancia);
    const precioManualNum = num(precio_manual) ?? num(productoActual.precio_manual);
    const categoriaNum = num(categoria_id) ?? num(productoActual.categoria_id);
    const inventarioNum = num(inventario_id) ?? num(productoActual.inventario_id);

    const precio_final_usd = calcularPrecioFinal(costoNum, porcentajeNum, precioManualNum, usarManual);

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
        costo_unitario = $5,
        porcentaje_ganancia = $6,
        precio_manual = $7,
        usar_precio_manual = $8,
        precio_final_usd = $9,
        imagen_url = $10,
        imagen_public_id = $11,
        tiene_toppings = $12
       WHERE id = $13
       RETURNING *`,
      [
        nombre || productoActual.nombre,
        descripcion !== undefined ? descripcion : productoActual.descripcion,
        categoriaNum,
        inventarioNum,
        costoNum,
        porcentajeNum,
        precioManualNum,
        usarManual,
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