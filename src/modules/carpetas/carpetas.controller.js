const pool = require('../../config/db');
const { cloudinary } = require('../../config/cloudinary');

// ── Admin: todas las carpetas con conteo de productos ──────────────────────
const obtenerCarpetas = async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT c.*,
              COUNT(p.id) AS total_productos
       FROM carpetas_productos c
       LEFT JOIN productos p ON p.carpeta_id = c.id
       GROUP BY c.id
       ORDER BY c.nombre ASC`
    );
    res.json({ carpetas: resultado.rows });
  } catch (err) {
    console.error('Error obteniendo carpetas:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// ── Público (catálogo/POS): solo carpetas activas que tengan al menos
//    1 producto activo adentro (si no, no hay nada que mostrar al hacer clic) ──
const obtenerCarpetasActivas = async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT c.id, c.nombre, c.imagen_url,
              COUNT(p.id) FILTER (WHERE COALESCE(p.activo, true) = true) AS total_productos
       FROM carpetas_productos c
       LEFT JOIN productos p ON p.carpeta_id = c.id
       WHERE c.activo = true
       GROUP BY c.id
       HAVING COUNT(p.id) FILTER (WHERE COALESCE(p.activo, true) = true) > 0
       ORDER BY c.nombre ASC`
    );
    res.json({ carpetas: resultado.rows });
  } catch (err) {
    console.error('Error obteniendo carpetas activas:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// ── Obtener 1 carpeta + sus productos (para abrirla y ver el contenido) ────
const obtenerCarpeta = async (req, res) => {
  const { id } = req.params;
  try {
    const carpeta = await pool.query('SELECT * FROM carpetas_productos WHERE id = $1', [id]);
    if (carpeta.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Carpeta no encontrada' });
    }

    const productos = await pool.query(
      `SELECT id, nombre, descripcion, precio_final_cop, precio_final_usd,
              imagen_url, tiene_toppings, categoria_id
       FROM productos
       WHERE carpeta_id = $1 AND COALESCE(activo, true) = true
       ORDER BY nombre ASC`,
      [id]
    );

    res.json({ carpeta: carpeta.rows[0], productos: productos.rows });
  } catch (err) {
    console.error('Error obteniendo carpeta:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const crearCarpeta = async (req, res) => {
  const { nombre } = req.body;
  try {
    if (!nombre) {
      return res.status(400).json({ mensaje: 'El nombre es requerido' });
    }

    let imagen_url = null;
    let imagen_public_id = null;
    if (req.file) {
      imagen_url = req.file.path;
      imagen_public_id = req.file.filename;
    }

    const resultado = await pool.query(
      `INSERT INTO carpetas_productos (nombre, imagen_url, imagen_public_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [nombre, imagen_url, imagen_public_id]
    );

    res.status(201).json({ mensaje: 'Carpeta creada exitosamente', carpeta: resultado.rows[0] });
  } catch (err) {
    console.error('Error creando carpeta:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const actualizarCarpeta = async (req, res) => {
  const { id } = req.params;
  const { nombre } = req.body;
  try {
    const existe = await pool.query('SELECT * FROM carpetas_productos WHERE id = $1', [id]);
    if (existe.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Carpeta no encontrada' });
    }
    const actual = existe.rows[0];

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

    const resultado = await pool.query(
      `UPDATE carpetas_productos SET
        nombre = COALESCE($1, nombre),
        imagen_url = $2,
        imagen_public_id = $3
       WHERE id = $4
       RETURNING *`,
      [nombre, imagen_url, imagen_public_id, id]
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

// Al eliminar la carpeta, los productos dentro quedan sueltos (carpeta_id -> NULL,
// gracias al ON DELETE SET NULL de la FK). No se borran productos.
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
    res.json({ mensaje: 'Carpeta eliminada. Sus productos quedaron sueltos en el catálogo.' });
  } catch (err) {
    console.error('Error eliminando carpeta:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

module.exports = {
  obtenerCarpetas,
  obtenerCarpetasActivas,
  obtenerCarpeta,
  crearCarpeta,
  actualizarCarpeta,
  toggleActivoCarpeta,
  eliminarCarpeta
};
