const pool = require('../../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const login = async (req, res) => {
  const { correo, contrasena } = req.body;

  try {
    if (!correo || !contrasena) {
      return res.status(400).json({ mensaje: 'Correo y contraseña son requeridos' });
    }

    const resultado = await pool.query(
      'SELECT * FROM usuarios WHERE correo = $1 AND activo = true',
      [correo]
    );

    if (resultado.rows.length === 0) {
      return res.status(401).json({ mensaje: 'Credenciales incorrectas' });
    }

    const usuario = resultado.rows[0];

    const contrasenaValida = await bcrypt.compare(contrasena, usuario.contrasena);
    if (!contrasenaValida) {
      return res.status(401).json({ mensaje: 'Credenciales incorrectas' });
    }

    const token = jwt.sign(
      {
        id: usuario.id,
        nombre: usuario.nombre,
        correo: usuario.correo,
        rol: usuario.rol
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
      mensaje: 'Login exitoso',
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        correo: usuario.correo,
        rol: usuario.rol
      }
    });

  } catch (err) {
    console.error('Error en login:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const perfil = async (req, res) => {
  try {
    const resultado = await pool.query(
      'SELECT id, nombre, correo, rol, creado_en FROM usuarios WHERE id = $1',
      [req.usuario.id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    res.json({ usuario: resultado.rows[0] });

  } catch (err) {
    console.error('Error obteniendo perfil:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

module.exports = { login, perfil };