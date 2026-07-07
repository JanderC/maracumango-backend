const pool = require('../../config/db');
const bcrypt = require('bcryptjs');

const obtenerUsuarios = async (req, res) => {
  try {
    const resultado = await pool.query(
      'SELECT id, nombre, correo, rol, activo, creado_en FROM usuarios ORDER BY creado_en DESC'
    );
    res.json({ usuarios: resultado.rows });
  } catch (err) {
    console.error('Error obteniendo usuarios:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const obtenerUsuario = async (req, res) => {
  const { id } = req.params;
  try {
    const resultado = await pool.query(
      'SELECT id, nombre, correo, rol, activo, creado_en FROM usuarios WHERE id = $1',
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    res.json({ usuario: resultado.rows[0] });
  } catch (err) {
    console.error('Error obteniendo usuario:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const crearUsuario = async (req, res) => {
  const { nombre, correo, contrasena, rol } = req.body;

  try {
    if (!nombre || !correo || !contrasena || !rol) {
      return res.status(400).json({ mensaje: 'Todos los campos son requeridos' });
    }

    if (!['admin', 'vendedor', 'cliente'].includes(rol)) {
      return res.status(400).json({ mensaje: 'Rol inválido. Use admin, vendedor o cliente' });
    }

    const existe = await pool.query('SELECT id FROM usuarios WHERE correo = $1', [correo]);
    if (existe.rows.length > 0) {
      return res.status(409).json({ mensaje: 'El correo ya está registrado' });
    }

    const salt = await bcrypt.genSalt(10);
    const contrasenaHash = await bcrypt.hash(contrasena, salt);

    const resultado = await pool.query(
      `INSERT INTO usuarios (nombre, correo, contrasena, rol)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nombre, correo, rol, activo, creado_en`,
      [nombre, correo, contrasenaHash, rol]
    );

    res.status(201).json({
      mensaje: 'Usuario creado exitosamente',
      usuario: resultado.rows[0]
    });

  } catch (err) {
    console.error('Error creando usuario:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const actualizarUsuario = async (req, res) => {
  const { id } = req.params;
  const { nombre, correo, contrasena, rol } = req.body;

  try {
    const existe = await pool.query('SELECT id FROM usuarios WHERE id = $1', [id]);
    if (existe.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    if (rol !== undefined && !['admin', 'vendedor', 'cliente'].includes(rol)) {
      return res.status(400).json({ mensaje: 'Rol inválido. Use admin, vendedor o cliente' });
    }

    let contrasenaHash = null;
    if (contrasena) {
      const salt = await bcrypt.genSalt(10);
      contrasenaHash = await bcrypt.hash(contrasena, salt);
    }

    const resultado = await pool.query(
      `UPDATE usuarios SET
        nombre = COALESCE($1, nombre),
        correo = COALESCE($2, correo),
        contrasena = COALESCE($3, contrasena),
        rol = COALESCE($4, rol)
       WHERE id = $5
       RETURNING id, nombre, correo, rol, activo, creado_en`,
      [nombre, correo, contrasenaHash, rol, id]
    );

    res.json({
      mensaje: 'Usuario actualizado exitosamente',
      usuario: resultado.rows[0]
    });

  } catch (err) {
    console.error('Error actualizando usuario:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const toggleActivoUsuario = async (req, res) => {
  const { id } = req.params;

  try {
    const resultado = await pool.query(
      `UPDATE usuarios SET activo = NOT activo
       WHERE id = $1
       RETURNING id, nombre, correo, rol, activo`,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    const estado = resultado.rows[0].activo ? 'activado' : 'desactivado';
    res.json({
      mensaje: `Usuario ${estado} exitosamente`,
      usuario: resultado.rows[0]
    });

  } catch (err) {
    console.error('Error cambiando estado usuario:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

module.exports = {
  obtenerUsuarios,
  obtenerUsuario,
  crearUsuario,
  actualizarUsuario,
  toggleActivoUsuario
};