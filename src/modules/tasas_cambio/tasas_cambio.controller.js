const pool = require('../../config/db');
const axios = require('axios');

// Consultar tasas en tiempo real desde dolarapi.com
const obtenerTasasBCV = async (req, res) => {
  try {
    const respuesta = await axios.get('https://ve.dolarapi.com/v1/cotizaciones');
    const cotizaciones = respuesta.data;

    // Filtramos solo las oficiales
    const oficial = cotizaciones.filter(c => c.fuente === 'oficial');

    const tasas = oficial.map(c => ({
      moneda: c.moneda,
      nombre: c.nombre,
      promedio: c.promedio,
      fecha_actualizacion: c.fechaActualizacion
    }));

    res.json({ fuente: 'BCV - Oficial', tasas });
  } catch (err) {
    console.error('Error consultando API BCV:', err.message);
    res.status(500).json({ mensaje: 'Error consultando tasas del BCV' });
  }
};

// Obtener todas las tasas guardadas en BD (manuales e importadas)
const obtenerTasas = async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT tc.*, u.nombre AS actualizado_por_nombre
       FROM tasas_cambio tc
       LEFT JOIN usuarios u ON tc.actualizado_por = u.id
       ORDER BY tc.actualizado_en DESC`
    );
    res.json({ tasas: resultado.rows });
  } catch (err) {
    console.error('Error obteniendo tasas:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// Obtener la tasa activa más reciente por moneda
const obtenerTasaActiva = async (req, res) => {
  const { moneda } = req.params; // BS o COP

  try {
    const resultado = await pool.query(
      `SELECT * FROM tasas_cambio
       WHERE moneda = $1
       ORDER BY actualizado_en DESC
       LIMIT 1`,
      [moneda.toUpperCase()]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: `No hay tasa registrada para ${moneda}` });
    }

    res.json({ tasa: resultado.rows[0] });
  } catch (err) {
    console.error('Error obteniendo tasa activa:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// Guardar tasa manual ingresada por el admin
const guardarTasaManual = async (req, res) => {
  const { moneda, tasa_por_usd } = req.body;

  try {
    if (!moneda || !tasa_por_usd) {
      return res.status(400).json({ mensaje: 'Moneda y tasa son requeridas' });
    }

    if (!['BS', 'COP'].includes(moneda.toUpperCase())) {
      return res.status(400).json({ mensaje: 'Moneda inválida. Use BS o COP' });
    }

    if (parseFloat(tasa_por_usd) <= 0) {
      return res.status(400).json({ mensaje: 'La tasa debe ser mayor a 0' });
    }

    const resultado = await pool.query(
      `INSERT INTO tasas_cambio (moneda, tasa_por_usd, actualizado_por)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [moneda.toUpperCase(), tasa_por_usd, req.usuario.id]
    );

    res.status(201).json({
      mensaje: 'Tasa manual guardada exitosamente',
      tasa: resultado.rows[0]
    });
  } catch (err) {
    console.error('Error guardando tasa manual:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// Importar tasa del BCV y guardarla en BD
const importarTasaBCV = async (req, res) => {
  const { moneda } = req.body; // USD o EUR (el que quiera usar como referencia BS)

  try {
    if (!moneda) {
      return res.status(400).json({ mensaje: 'Moneda BCV es requerida (USD o EUR)' });
    }

    const respuesta = await axios.get('https://ve.dolarapi.com/v1/cotizaciones');
    const cotizaciones = respuesta.data;

    const encontrada = cotizaciones.find(
      c => c.fuente === 'oficial' && c.moneda.toUpperCase() === moneda.toUpperCase()
    );

    if (!encontrada || !encontrada.promedio) {
      return res.status(404).json({ mensaje: `No se encontró tasa oficial para ${moneda}` });
    }

    // Siempre se guarda como BS (bolívares)
    const resultado = await pool.query(
      `INSERT INTO tasas_cambio (moneda, tasa_por_usd, actualizado_por)
       VALUES ($1, $2, $3)
       RETURNING *`,
      ['BS', encontrada.promedio, req.usuario.id]
    );

    res.status(201).json({
      mensaje: `Tasa BCV importada exitosamente (${encontrada.nombre}: ${encontrada.promedio})`,
      tasa: resultado.rows[0]
    });
  } catch (err) {
    console.error('Error importando tasa BCV:', err.message);
    res.status(500).json({ mensaje: 'Error importando tasa del BCV' });
  }
};

module.exports = {
  obtenerTasasBCV,
  obtenerTasas,
  obtenerTasaActiva,
  guardarTasaManual,
  importarTasaBCV
};