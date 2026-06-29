const pool = require('../../config/db');

const obtenerCategorias = async (req, res) => {
  try {
    const resultado = await pool.query(
      'SELECT * FROM categorias ORDER BY creado_en DESC'
    );
    res.json({ categorias: resultado.rows });
  } catch (err) {
    console.error('Error obteniendo categorias:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const obtenerCategoria = async (req, res) => {
  const { id } = req.params;
  try {
    const resultado = await pool.query(
      'SELECT * FROM categorias WHERE id = $1',
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Categoría no encontrada' });
    }

    res.json({ categoria: resultado.rows[0] });
  } catch (err) {
    console.error('Error obteniendo categoria:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const crearCategoria = async (req, res) => {
  const { nombre, descripcion } = req.body;

  try {
    if (!nombre) {
      return res.status(400).json({ mensaje: 'El nombre es requerido' });
    }

    const existe = await pool.query(
      'SELECT id FROM categorias WHERE LOWER(nombre) = LOWER($1)',
      [nombre]
    );
    if (existe.rows.length > 0) {
      return res.status(409).json({ mensaje: 'Ya existe una categoría con ese nombre' });
    }

    const resultado = await pool.query(
      `INSERT INTO categorias (nombre, descripcion)
       VALUES ($1, $2)
       RETURNING *`,
      [nombre, descripcion]
    );

    res.status(201).json({
      mensaje: 'Categoría creada exitosamente',
      categoria: resultado.rows[0]
    });
  } catch (err) {
    console.error('Error creando categoria:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const actualizarCategoria = async (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion } = req.body;

  try {
    const existe = await pool.query(
      'SELECT id FROM categorias WHERE id = $1',
      [id]
    );
    if (existe.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Categoría no encontrada' });
    }

    const resultado = await pool.query(
      `UPDATE categorias SET
        nombre = COALESCE($1, nombre),
        descripcion = COALESCE($2, descripcion)
       WHERE id = $3
       RETURNING *`,
      [nombre, descripcion, id]
    );

    res.json({
      mensaje: 'Categoría actualizada exitosamente',
      categoria: resultado.rows[0]
    });
  } catch (err) {
    console.error('Error actualizando categoria:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const eliminarCategoria = async (req, res) => {
  const { id } = req.params;

  try {
    const tieneProductos = await pool.query(
      'SELECT id FROM productos WHERE categoria_id = $1 LIMIT 1',
      [id]
    );
    if (tieneProductos.rows.length > 0) {
      return res.status(409).json({
        mensaje: 'No se puede eliminar la categoría porque tiene productos asociados'
      });
    }

    const tieneInventario = await pool.query(
      'SELECT id FROM inventario WHERE categoria_id = $1 LIMIT 1',
      [id]
    );
    if (tieneInventario.rows.length > 0) {
      return res.status(409).json({
        mensaje: 'No se puede eliminar la categoría porque tiene inventario asociado'
      });
    }

    const resultado = await pool.query(
      'DELETE FROM categorias WHERE id = $1 RETURNING *',
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Categoría no encontrada' });
    }

    res.json({ mensaje: 'Categoría eliminada exitosamente' });
  } catch (err) {
    console.error('Error eliminando categoria:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

module.exports = {
  obtenerCategorias,
  obtenerCategoria,
  crearCategoria,
  actualizarCategoria,
  eliminarCategoria
};