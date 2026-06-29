const pool = require('../../config/db');

const obtenerCuentas = async (req, res) => {
  try {
    const resultado = await pool.query(
      'SELECT * FROM cuentas_bancarias ORDER BY moneda ASC, nombre_banco ASC'
    );
    res.json({ cuentas: resultado.rows });
  } catch (err) {
    console.error('Error obteniendo cuentas:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const obtenerCuentasPorMoneda = async (req, res) => {
  const { moneda } = req.params;
  try {
    const resultado = await pool.query(
      `SELECT * FROM cuentas_bancarias
       WHERE moneda = $1 AND activo = true
       ORDER BY nombre_banco ASC`,
      [moneda.toUpperCase()]
    );
    res.json({ cuentas: resultado.rows });
  } catch (err) {
    console.error('Error obteniendo cuentas por moneda:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const obtenerCuenta = async (req, res) => {
  const { id } = req.params;
  try {
    const resultado = await pool.query(
      'SELECT * FROM cuentas_bancarias WHERE id = $1',
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Cuenta bancaria no encontrada' });
    }

    res.json({ cuenta: resultado.rows[0] });
  } catch (err) {
    console.error('Error obteniendo cuenta:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const crearCuenta = async (req, res) => {
  const { nombre_banco, numero_cuenta, titular_cuenta, moneda, telefono } = req.body;

  try {
    if (!nombre_banco || !moneda) {
      return res.status(400).json({ mensaje: 'Nombre del banco y moneda son requeridos' });
    }

    if (!['USD', 'BS', 'COP'].includes(moneda.toUpperCase())) {
      return res.status(400).json({ mensaje: 'Moneda inválida. Use USD, BS o COP' });
    }

    const resultado = await pool.query(
      `INSERT INTO cuentas_bancarias
        (nombre_banco, numero_cuenta, titular_cuenta, moneda, telefono)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [nombre_banco, numero_cuenta, titular_cuenta, moneda.toUpperCase(), telefono]
    );

    res.status(201).json({
      mensaje: 'Cuenta bancaria creada exitosamente',
      cuenta: resultado.rows[0]
    });
  } catch (err) {
    console.error('Error creando cuenta:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const actualizarCuenta = async (req, res) => {
  const { id } = req.params;
  const { nombre_banco, numero_cuenta, titular_cuenta, moneda, telefono } = req.body;

  try {
    const existe = await pool.query(
      'SELECT id FROM cuentas_bancarias WHERE id = $1',
      [id]
    );
    if (existe.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Cuenta bancaria no encontrada' });
    }

    const resultado = await pool.query(
      `UPDATE cuentas_bancarias SET
        nombre_banco = COALESCE($1, nombre_banco),
        numero_cuenta = COALESCE($2, numero_cuenta),
        titular_cuenta = COALESCE($3, titular_cuenta),
        moneda = COALESCE($4, moneda),
        telefono = COALESCE($5, telefono)
       WHERE id = $6
       RETURNING *`,
      [nombre_banco, numero_cuenta, titular_cuenta, moneda ? moneda.toUpperCase() : null, telefono, id]
    );

    res.json({
      mensaje: 'Cuenta bancaria actualizada exitosamente',
      cuenta: resultado.rows[0]
    });
  } catch (err) {
    console.error('Error actualizando cuenta:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const toggleActivoCuenta = async (req, res) => {
  const { id } = req.params;
  try {
    const resultado = await pool.query(
      'UPDATE cuentas_bancarias SET activo = NOT activo WHERE id = $1 RETURNING *',
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Cuenta bancaria no encontrada' });
    }

    const estado = resultado.rows[0].activo ? 'activada' : 'desactivada';
    res.json({ mensaje: `Cuenta ${estado} exitosamente`, cuenta: resultado.rows[0] });
  } catch (err) {
    console.error('Error cambiando estado cuenta:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const eliminarCuenta = async (req, res) => {
  const { id } = req.params;
  try {
    const resultado = await pool.query(
      'DELETE FROM cuentas_bancarias WHERE id = $1 RETURNING *',
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Cuenta bancaria no encontrada' });
    }

    res.json({ mensaje: 'Cuenta bancaria eliminada exitosamente' });
  } catch (err) {
    console.error('Error eliminando cuenta:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

module.exports = {
  obtenerCuentas,
  obtenerCuentasPorMoneda,
  obtenerCuenta,
  crearCuenta,
  actualizarCuenta,
  toggleActivoCuenta,
  eliminarCuenta
};