const pool = require('../../config/db');

const obtenerInventario = async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT i.*, c.nombre AS categoria
       FROM inventario i
       LEFT JOIN categorias c ON i.categoria_id = c.id
       ORDER BY i.creado_en DESC`
    );
    res.json({ inventario: resultado.rows });
  } catch (err) {
    console.error('Error obteniendo inventario:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const obtenerItemInventario = async (req, res) => {
  const { id } = req.params;
  try {
    const resultado = await pool.query(
      `SELECT i.*, c.nombre AS categoria
       FROM inventario i
       LEFT JOIN categorias c ON i.categoria_id = c.id
       WHERE i.id = $1`,
      [id]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Item no encontrado' });
    }
    res.json({ item: resultado.rows[0] });
  } catch (err) {
    console.error('Error obteniendo item:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const crearItemInventario = async (req, res) => {
  const {
    nombre, descripcion, categoria_id,
    cantidad, unidad_medida,
    costo_total, moneda_compra, tasa_cambio,
    proveedor, fecha_compra
  } = req.body;

  try {
    if (!nombre || !cantidad || !costo_total || !moneda_compra) {
      return res.status(400).json({ mensaje: 'Nombre, cantidad, costo total y moneda son requeridos' });
    }

    if (!['USD', 'BS', 'COP'].includes(moneda_compra.toUpperCase())) {
      return res.status(400).json({ mensaje: 'Moneda inválida. Use USD, BS o COP' });
    }

    const costoTotal = parseFloat(costo_total);
    const cant = parseInt(cantidad);
    const costo_unitario = costoTotal / cant;

    // Calcular equivalente en USD
    let costo_total_usd = null;
    let costo_unitario_usd = null;

    if (moneda_compra.toUpperCase() === 'USD') {
      costo_total_usd = costoTotal;
      costo_unitario_usd = costo_unitario;
    } else if (tasa_cambio && parseFloat(tasa_cambio) > 0) {
      costo_total_usd = parseFloat((costoTotal / parseFloat(tasa_cambio)).toFixed(2));
      costo_unitario_usd = parseFloat((costo_total_usd / cant).toFixed(4));
    }

    const resultado = await pool.query(
      `INSERT INTO inventario
        (nombre, descripcion, categoria_id, cantidad, unidad_medida,
         costo_total, costo_unitario, moneda_compra, tasa_cambio,
         costo_total_usd, costo_unitario_usd, proveedor, fecha_compra)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        nombre, descripcion, categoria_id || null, cant, unidad_medida,
        costoTotal, costo_unitario, moneda_compra.toUpperCase(), tasa_cambio || null,
        costo_total_usd, costo_unitario_usd, proveedor, fecha_compra || null
      ]
    );

    res.status(201).json({
      mensaje: 'Item de inventario creado exitosamente',
      item: resultado.rows[0]
    });
  } catch (err) {
    console.error('Error creando item:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const actualizarItemInventario = async (req, res) => {
  const { id } = req.params;
  const {
    nombre, descripcion, categoria_id,
    cantidad, unidad_medida,
    costo_total, moneda_compra, tasa_cambio,
    proveedor, fecha_compra
  } = req.body;

  try {
    const existe = await pool.query('SELECT * FROM inventario WHERE id = $1', [id]);
    if (existe.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Item no encontrado' });
    }

    const actual = existe.rows[0];
    const nuevaCantidad = cantidad ? parseInt(cantidad) : actual.cantidad;
    const nuevoCostoTotal = costo_total ? parseFloat(costo_total) : parseFloat(actual.costo_total);
    const nuevaMoneda = moneda_compra ? moneda_compra.toUpperCase() : actual.moneda_compra;
    const nuevaTasa = tasa_cambio ? parseFloat(tasa_cambio) : actual.tasa_cambio;
    const nuevoCostoUnitario = nuevoCostoTotal / nuevaCantidad;

    let costo_total_usd = actual.costo_total_usd;
    let costo_unitario_usd = actual.costo_unitario_usd;

    if (nuevaMoneda === 'USD') {
      costo_total_usd = nuevoCostoTotal;
      costo_unitario_usd = nuevoCostoUnitario;
    } else if (nuevaTasa && nuevaTasa > 0) {
      costo_total_usd = parseFloat((nuevoCostoTotal / nuevaTasa).toFixed(2));
      costo_unitario_usd = parseFloat((costo_total_usd / nuevaCantidad).toFixed(4));
    }

    const resultado = await pool.query(
      `UPDATE inventario SET
        nombre = COALESCE($1, nombre),
        descripcion = COALESCE($2, descripcion),
        categoria_id = COALESCE($3, categoria_id),
        cantidad = $4,
        unidad_medida = COALESCE($5, unidad_medida),
        costo_total = $6,
        costo_unitario = $7,
        moneda_compra = $8,
        tasa_cambio = $9,
        costo_total_usd = $10,
        costo_unitario_usd = $11,
        proveedor = COALESCE($12, proveedor),
        fecha_compra = COALESCE($13, fecha_compra)
       WHERE id = $14
       RETURNING *`,
      [
        nombre, descripcion, categoria_id,
        nuevaCantidad, unidad_medida,
        nuevoCostoTotal, nuevoCostoUnitario,
        nuevaMoneda, nuevaTasa,
        costo_total_usd, costo_unitario_usd,
        proveedor, fecha_compra, id
      ]
    );

    res.json({
      mensaje: 'Item actualizado exitosamente',
      item: resultado.rows[0]
    });
  } catch (err) {
    console.error('Error actualizando item:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const ajustarCantidad = async (req, res) => {
  const { id } = req.params;
  const { cantidad, operacion } = req.body;

  try {
    if (!cantidad || !operacion) {
      return res.status(400).json({ mensaje: 'Cantidad y operación son requeridas' });
    }
    if (!['sumar', 'restar'].includes(operacion)) {
      return res.status(400).json({ mensaje: 'Operación inválida. Use sumar o restar' });
    }

    const actual = await pool.query('SELECT * FROM inventario WHERE id = $1', [id]);
    if (actual.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Item no encontrado' });
    }

    const cantidadActual = actual.rows[0].cantidad;
    const nuevaCantidad = operacion === 'sumar'
      ? cantidadActual + parseInt(cantidad)
      : cantidadActual - parseInt(cantidad);

    if (nuevaCantidad < 0) {
      return res.status(400).json({ mensaje: 'La cantidad no puede ser negativa' });
    }

    const resultado = await pool.query(
      'UPDATE inventario SET cantidad = $1 WHERE id = $2 RETURNING *',
      [nuevaCantidad, id]
    );

    res.json({ mensaje: 'Cantidad ajustada', item: resultado.rows[0] });
  } catch (err) {
    console.error('Error ajustando cantidad:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const eliminarItemInventario = async (req, res) => {
  const { id } = req.params;
  try {
    const tieneProductos = await pool.query(
      'SELECT id FROM productos WHERE inventario_id = $1 LIMIT 1', [id]
    );
    if (tieneProductos.rows.length > 0) {
      return res.status(409).json({ mensaje: 'No se puede eliminar, tiene productos asociados' });
    }

    const resultado = await pool.query('DELETE FROM inventario WHERE id = $1 RETURNING *', [id]);
    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Item no encontrado' });
    }

    res.json({ mensaje: 'Item eliminado exitosamente' });
  } catch (err) {
    console.error('Error eliminando item:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

module.exports = {
  obtenerInventario,
  obtenerItemInventario,
  crearItemInventario,
  actualizarItemInventario,
  ajustarCantidad,
  eliminarItemInventario
};