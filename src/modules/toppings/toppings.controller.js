const pool = require('../../config/db');
const { resolverCodigo } = require('../../utils/codigo.helper');

const obtenerToppings = async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM toppings ORDER BY nombre ASC');
    res.json({ toppings: resultado.rows });
  } catch (err) {
    console.error('Error obteniendo toppings:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const obtenerTopping = async (req, res) => {
  const { id } = req.params;
  try {
    const resultado = await pool.query('SELECT * FROM toppings WHERE id = $1', [id]);
    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Topping no encontrado' });
    }
    res.json({ topping: resultado.rows[0] });
  } catch (err) {
    console.error('Error obteniendo topping:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// Función helper para calcular conversiones desde COP
const calcularConversiones = async (precio_cop) => {
  const preciosCOP = parseFloat(precio_cop) || 0;

  const tasaCOP = await pool.query(
    `SELECT tasa_por_usd FROM tasas_cambio WHERE moneda = 'COP' ORDER BY actualizado_en DESC LIMIT 1`
  );
  const tasaBS = await pool.query(
    `SELECT tasa_por_usd FROM tasas_cambio WHERE moneda = 'BS' ORDER BY actualizado_en DESC LIMIT 1`
  );

  let precio_usd = 0;
  let precio_bs = 0;

  if (preciosCOP > 0) {
    if (tasaCOP.rows.length > 0) {
      precio_usd = parseFloat((preciosCOP / parseFloat(tasaCOP.rows[0].tasa_por_usd)).toFixed(4));
    }
    if (tasaBS.rows.length > 0 && precio_usd > 0) {
      precio_bs = parseFloat((precio_usd * parseFloat(tasaBS.rows[0].tasa_por_usd)).toFixed(2));
    }
  }

  return { precio_usd, precio_bs };
};

const crearTopping = async (req, res) => {
  const { nombre, precio_cop, codigo } = req.body;

  try {
    if (!nombre) {
      return res.status(400).json({ mensaje: 'El nombre es requerido' });
    }
    if (precio_cop === undefined || precio_cop === '') {
      return res.status(400).json({ mensaje: 'El precio en COP es requerido (puede ser 0 si es gratis)' });
    }

    const existe = await pool.query(
      'SELECT id FROM toppings WHERE LOWER(nombre) = LOWER($1)', [nombre]
    );
    if (existe.rows.length > 0) {
      return res.status(409).json({ mensaje: 'Ya existe un topping con ese nombre' });
    }

    let codigoFinal;
    try {
      codigoFinal = await resolverCodigo({ tabla: 'toppings', prefijo: 'TOP', codigoInput: codigo });
    } catch (e) {
      return res.status(e.status || 500).json({ mensaje: e.mensaje || 'Error resolviendo código' });
    }

    const { precio_usd, precio_bs } = await calcularConversiones(precio_cop);

    const resultado = await pool.query(
      `INSERT INTO toppings (nombre, precio_cop, precio_usd, precio_bs, codigo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [nombre, parseFloat(precio_cop) || 0, precio_usd, precio_bs, codigoFinal]
    );

    res.status(201).json({
      mensaje: 'Topping creado exitosamente',
      topping: resultado.rows[0]
    });
  } catch (err) {
    console.error('Error creando topping:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const actualizarTopping = async (req, res) => {
  const { id } = req.params;
  const { nombre, precio_cop, codigo } = req.body;

  try {
    const existe = await pool.query('SELECT * FROM toppings WHERE id = $1', [id]);
    if (existe.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Topping no encontrado' });
    }

    const actual = existe.rows[0];

    let codigoFinal = actual.codigo;
    if (codigo !== undefined && String(codigo).trim() !== '' && codigo !== actual.codigo) {
      try {
        codigoFinal = await resolverCodigo({ tabla: 'toppings', prefijo: 'TOP', codigoInput: codigo, excluirId: id });
      } catch (e) {
        return res.status(e.status || 500).json({ mensaje: e.mensaje || 'Error resolviendo código' });
      }
    }

    const { precio_usd, precio_bs } = await calcularConversiones(precio_cop);

    const resultado = await pool.query(
      `UPDATE toppings SET
        nombre = COALESCE($1, nombre),
        precio_cop = COALESCE($2, precio_cop),
        precio_usd = $3,
        precio_bs = $4,
        codigo = $5
       WHERE id = $6
       RETURNING *`,
      [nombre, parseFloat(precio_cop) || 0, precio_usd, precio_bs, codigoFinal, id]
    );

    res.json({
      mensaje: 'Topping actualizado exitosamente',
      topping: resultado.rows[0]
    });
  } catch (err) {
    console.error('Error actualizando topping:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const toggleActivoTopping = async (req, res) => {
  const { id } = req.params;
  try {
    const resultado = await pool.query(
      'UPDATE toppings SET activo = NOT activo WHERE id = $1 RETURNING *', [id]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Topping no encontrado' });
    }
    const estado = resultado.rows[0].activo ? 'activado' : 'desactivado';
    res.json({ mensaje: `Topping ${estado}`, topping: resultado.rows[0] });
  } catch (err) {
    console.error('Error toggling topping:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const eliminarTopping = async (req, res) => {
  const { id } = req.params;
  try {
    const resultado = await pool.query(
      'DELETE FROM toppings WHERE id = $1 RETURNING *', [id]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Topping no encontrado' });
    }
    res.json({ mensaje: 'Topping eliminado exitosamente' });
  } catch (err) {
    console.error('Error eliminando topping:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

module.exports = {
  obtenerToppings,
  obtenerTopping,
  crearTopping,
  actualizarTopping,
  toggleActivoTopping,
  eliminarTopping
};