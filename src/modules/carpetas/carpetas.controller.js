const pool = require('../../config/db');
const { cloudinary } = require('../../config/cloudinary');

// ── Admin: todas las carpetas (de un nivel dado) con conteo de productos ───
// ?carpeta_padre_id=  -> si no se envía, trae las de primer nivel (padre = NULL)
//                        si se envía, trae las subcarpetas de esa carpeta
const obtenerCarpetas = async (req, res) => {
  try {
    const { carpeta_padre_id, todas } = req.query;

    // ?todas=true -> lista PLANA de TODAS las carpetas (para el selector del
    // formulario de producto), incluye el nombre de la carpeta padre para
    // poder mostrar "Padre / Subcarpeta" en el <select>
    if (todas === 'true' || todas === '1') {
      const resultado = await pool.query(
        `SELECT c.*,
                padre.nombre AS carpeta_padre_nombre,
                COUNT(DISTINCT p.id) AS total_productos,
                COUNT(DISTINCT sub.id) AS total_subcarpetas
         FROM carpetas_productos c
         LEFT JOIN carpetas_productos padre ON padre.id = c.carpeta_padre_id
         LEFT JOIN productos p ON p.carpeta_id = c.id
         LEFT JOIN carpetas_productos sub ON sub.carpeta_padre_id = c.id
         GROUP BY c.id, padre.nombre
         ORDER BY padre.nombre ASC NULLS FIRST, c.orden ASC, c.nombre ASC`
      );
      return res.json({ carpetas: resultado.rows });
    }

    const params = [];
    let whereClause = 'c.carpeta_padre_id IS NULL';
    if (carpeta_padre_id !== undefined && carpeta_padre_id !== '') {
      whereClause = 'c.carpeta_padre_id = $1';
      params.push(carpeta_padre_id);
    }

    const resultado = await pool.query(
      `SELECT c.*,
              COUNT(DISTINCT p.id) AS total_productos,
              COUNT(DISTINCT sub.id) AS total_subcarpetas
       FROM carpetas_productos c
       LEFT JOIN productos p ON p.carpeta_id = c.id
       LEFT JOIN carpetas_productos sub ON sub.carpeta_padre_id = c.id
       WHERE ${whereClause}
       GROUP BY c.id
       ORDER BY c.orden ASC, c.nombre ASC`,
      params
    );
    res.json({ carpetas: resultado.rows });
  } catch (err) {
    console.error('Error obteniendo carpetas:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// ── Público (catálogo/POS): carpetas activas de un nivel, que tengan algo
//    que mostrar (al menos 1 producto activo O 1 subcarpeta con contenido) ──
// ?carpeta_padre_id= -> igual que arriba, define el nivel a consultar
const obtenerCarpetasActivas = async (req, res) => {
  try {
    const { carpeta_padre_id } = req.query;

    const params = [];
    let whereClause = 'c.carpeta_padre_id IS NULL';
    if (carpeta_padre_id !== undefined && carpeta_padre_id !== '') {
      whereClause = 'c.carpeta_padre_id = $1';
      params.push(carpeta_padre_id);
    }

    const resultado = await pool.query(
      `SELECT c.id, c.nombre, c.imagen_url, c.carpeta_padre_id, c.orden,
              COUNT(DISTINCT p.id) FILTER (WHERE COALESCE(p.activo, true) = true) AS total_productos,
              COUNT(DISTINCT sub.id) FILTER (WHERE COALESCE(sub.activo, true) = true) AS total_subcarpetas
       FROM carpetas_productos c
       LEFT JOIN productos p ON p.carpeta_id = c.id
       LEFT JOIN carpetas_productos sub ON sub.carpeta_padre_id = c.id
       WHERE ${whereClause} AND c.activo = true
       GROUP BY c.id
       HAVING
         COUNT(DISTINCT p.id) FILTER (WHERE COALESCE(p.activo, true) = true) > 0
         OR COUNT(DISTINCT sub.id) FILTER (WHERE COALESCE(sub.activo, true) = true) > 0
       ORDER BY c.orden ASC, c.nombre ASC`,
      params
    );
    res.json({ carpetas: resultado.rows });
  } catch (err) {
    console.error('Error obteniendo carpetas activas:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// ── Obtener 1 carpeta + sus subcarpetas + sus productos ────────────────────
const obtenerCarpeta = async (req, res) => {
  const { id } = req.params;
  try {
    const carpeta = await pool.query('SELECT * FROM carpetas_productos WHERE id = $1', [id]);
    if (carpeta.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Carpeta no encontrada' });
    }

    // Subcarpetas activas dentro de esta carpeta
    const subcarpetas = await pool.query(
      `SELECT c.id, c.nombre, c.imagen_url, c.carpeta_padre_id, c.orden,
              COUNT(DISTINCT p.id) FILTER (WHERE COALESCE(p.activo, true) = true) AS total_productos
       FROM carpetas_productos c
       LEFT JOIN productos p ON p.carpeta_id = c.id
       WHERE c.carpeta_padre_id = $1 AND c.activo = true
       GROUP BY c.id
       ORDER BY c.orden ASC, c.nombre ASC`,
      [id]
    );

    // Productos directos de esta carpeta, respetando el orden manual
    const productos = await pool.query(
      `SELECT id, nombre, descripcion, precio_final_cop, precio_final_usd,
              imagen_url, tiene_toppings, categoria_id, orden
       FROM productos
       WHERE carpeta_id = $1 AND COALESCE(activo, true) = true
       ORDER BY orden ASC, nombre ASC`,
      [id]
    );

    res.json({
      carpeta: carpeta.rows[0],
      subcarpetas: subcarpetas.rows,
      productos: productos.rows
    });
  } catch (err) {
    console.error('Error obteniendo carpeta:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const crearCarpeta = async (req, res) => {
  const { nombre, carpeta_padre_id, orden } = req.body;
  try {
    if (!nombre) {
      return res.status(400).json({ mensaje: 'El nombre es requerido' });
    }

    if (carpeta_padre_id) {
      const padre = await pool.query('SELECT id FROM carpetas_productos WHERE id = $1', [carpeta_padre_id]);
      if (padre.rows.length === 0) {
        return res.status(400).json({ mensaje: 'La carpeta padre indicada no existe' });
      }
    }

    let imagen_url = null;
    let imagen_public_id = null;
    if (req.file) {
      imagen_url = req.file.path;
      imagen_public_id = req.file.filename;
    }

    const resultado = await pool.query(
      `INSERT INTO carpetas_productos (nombre, imagen_url, imagen_public_id, carpeta_padre_id, orden)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [nombre, imagen_url, imagen_public_id, carpeta_padre_id || null, orden || 0]
    );

    res.status(201).json({ mensaje: 'Carpeta creada exitosamente', carpeta: resultado.rows[0] });
  } catch (err) {
    console.error('Error creando carpeta:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const actualizarCarpeta = async (req, res) => {
  const { id } = req.params;
  const { nombre, carpeta_padre_id, orden } = req.body;
  try {
    const existe = await pool.query('SELECT * FROM carpetas_productos WHERE id = $1', [id]);
    if (existe.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Carpeta no encontrada' });
    }
    const actual = existe.rows[0];

    if (carpeta_padre_id && String(carpeta_padre_id) === String(id)) {
      return res.status(400).json({ mensaje: 'Una carpeta no puede ser su propia carpeta padre' });
    }

    let imagen_url = actual.imagen_url;
    let imagen_public_id = actual.imagen_public_id;

    if (req.file) {
      if (actual.imagen_public_id) {
        try {
          await cloudinary.uploader.destroy(actual.imagen_public_id);
        } catch (e) {
          console.warn('No se pudo eliminar imagen anterior:', e.message);
        }
      }
      imagen_url = req.file.path;
      imagen_public_id = req.file.filename;
    }

    const nuevoPadre = carpeta_padre_id !== undefined ? (carpeta_padre_id || null) : actual.carpeta_padre_id;
    const nuevoOrden = orden !== undefined ? orden : actual.orden;

    const resultado = await pool.query(
      `UPDATE carpetas_productos SET
        nombre = COALESCE($1, nombre),
        imagen_url = $2,
        imagen_public_id = $3,
        carpeta_padre_id = $4,
        orden = $5
       WHERE id = $6
       RETURNING *`,
      [nombre, imagen_url, imagen_public_id, nuevoPadre, nuevoOrden, id]
    );

    res.json({ mensaje: 'Carpeta actualizada exitosamente', carpeta: resultado.rows[0] });
  } catch (err) {
    console.error('Error actualizando carpeta:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const toggleActivoCarpeta = async (req, res) => {
  const { id } = req.params;
  try {
    const resultado = await pool.query(
      'UPDATE carpetas_productos SET activo = NOT COALESCE(activo, true) WHERE id = $1 RETURNING *',
      [id]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Carpeta no encontrada' });
    }
    const estado = resultado.rows[0].activo ? 'activada' : 'desactivada';
    res.json({ mensaje: `Carpeta ${estado}`, carpeta: resultado.rows[0] });
  } catch (err) {
    console.error('Error toggling carpeta:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// Al eliminar la carpeta:
//  - los productos dentro quedan sueltos (carpeta_id -> NULL, ON DELETE SET NULL)
//  - las subcarpetas dentro quedan como carpetas de primer nivel (carpeta_padre_id -> NULL)
const eliminarCarpeta = async (req, res) => {
  const { id } = req.params;
  try {
    const existe = await pool.query('SELECT * FROM carpetas_productos WHERE id = $1', [id]);
    if (existe.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Carpeta no encontrada' });
    }

    if (existe.rows[0].imagen_public_id) {
      try {
        await cloudinary.uploader.destroy(existe.rows[0].imagen_public_id);
      } catch (e) {
        console.warn('No se pudo eliminar imagen de Cloudinary:', e.message);
      }
    }

    await pool.query('DELETE FROM carpetas_productos WHERE id = $1', [id]);
    res.json({ mensaje: 'Carpeta eliminada. Sus productos y subcarpetas quedaron sueltos en el nivel superior.' });
  } catch (err) {
    console.error('Error eliminando carpeta:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// ── Reordenar carpetas (drag & drop en el admin) ───────────────────────────
// body: { orden: [{ id, orden }, ...] }
const reordenarCarpetas = async (req, res) => {
  const { orden } = req.body;
  if (!Array.isArray(orden) || orden.length === 0) {
    return res.status(400).json({ mensaje: 'Debes enviar un arreglo "orden" con { id, orden }' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of orden) {
      await client.query('UPDATE carpetas_productos SET orden = $1 WHERE id = $2', [item.orden, item.id]);
    }
    await client.query('COMMIT');
    res.json({ mensaje: 'Orden de carpetas actualizado' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error reordenando carpetas:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  } finally {
    client.release();
  }
};

// ── Reordenar productos dentro de una carpeta (drag & drop en el admin) ───
// body: { orden: [{ id, orden }, ...] }
const reordenarProductos = async (req, res) => {
  const { orden } = req.body;
  if (!Array.isArray(orden) || orden.length === 0) {
    return res.status(400).json({ mensaje: 'Debes enviar un arreglo "orden" con { id, orden }' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of orden) {
      await client.query('UPDATE productos SET orden = $1 WHERE id = $2', [item.orden, item.id]);
    }
    await client.query('COMMIT');
    res.json({ mensaje: 'Orden de productos actualizado' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error reordenando productos:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  } finally {
    client.release();
  }
};

module.exports = {
  obtenerCarpetas,
  obtenerCarpetasActivas,
  obtenerCarpeta,
  crearCarpeta,
  actualizarCarpeta,
  toggleActivoCarpeta,
  eliminarCarpeta,
  reordenarCarpetas,
  reordenarProductos
};