const pool = require('../config/db');

const REGEX_CODIGO = /^[A-Z0-9-]{2,30}$/;

/**
 * Genera el siguiente código autogenerado para una tabla dada, con el prefijo indicado.
 * Busca el número más alto ya usado con ese prefijo y le suma 1.
 * Ej: generarCodigo('productos', 'PRD') -> 'PRD-0001', 'PRD-0002', ...
 */
const generarCodigo = async (tabla, prefijo, client = pool) => {
  const resultado = await client.query(
    `SELECT codigo FROM ${tabla}
     WHERE codigo LIKE $1
     ORDER BY LENGTH(codigo) DESC, codigo DESC
     LIMIT 1`,
    [`${prefijo}-%`]
  );

  let siguiente = 1;
  if (resultado.rows.length > 0) {
    const ultimo = resultado.rows[0].codigo;
    const numeroStr = ultimo.replace(`${prefijo}-`, '');
    const numero = parseInt(numeroStr, 10);
    if (!isNaN(numero)) siguiente = numero + 1;
  }

  const padding = siguiente > 9999 ? 5 : 4;
  return `${prefijo}-${String(siguiente).padStart(padding, '0')}`;
};

/**
 * Valida y normaliza un código ingresado manualmente.
 * Retorna { ok: true, codigo } o { ok: false, mensaje }.
 */
const validarCodigoManual = (codigoRaw) => {
  const codigo = String(codigoRaw).trim().toUpperCase();
  if (!REGEX_CODIGO.test(codigo)) {
    return {
      ok: false,
      mensaje: 'El código solo puede contener letras mayúsculas, números y guion medio (2 a 30 caracteres)'
    };
  }
  return { ok: true, codigo };
};

/**
 * Verifica si un código ya existe en una tabla (opcionalmente excluyendo un id, útil al editar).
 */
const codigoExiste = async (tabla, codigo, excluirId = null, client = pool) => {
  const query = excluirId
    ? `SELECT id FROM ${tabla} WHERE codigo = $1 AND id != $2`
    : `SELECT id FROM ${tabla} WHERE codigo = $1`;
  const params = excluirId ? [codigo, excluirId] : [codigo];
  const resultado = await client.query(query, params);
  return resultado.rows.length > 0;
};

/**
 * Resuelve el código final a guardar: si viene vacío, autogenera; si viene manual, valida y verifica unicidad.
 * Reintenta una vez la autogeneración ante colisión por condición de carrera (código postgres 23505).
 * Lanza un objeto { status, mensaje } en caso de error, para que el controller lo capture y responda.
 */
const resolverCodigo = async ({ tabla, prefijo, codigoInput, excluirId = null, client = pool }) => {
  const vieneVacio = codigoInput === undefined || codigoInput === null || String(codigoInput).trim() === '';

  if (vieneVacio) {
    let intento = 0;
    while (intento < 2) {
      const candidato = await generarCodigo(tabla, prefijo, client);
      const existe = await codigoExiste(tabla, candidato, excluirId, client);
      if (!existe) return candidato;
      intento++;
    }
    throw { status: 500, mensaje: 'No se pudo generar un código único, intenta de nuevo' };
  }

  const validacion = validarCodigoManual(codigoInput);
  if (!validacion.ok) {
    throw { status: 400, mensaje: validacion.mensaje };
  }

  const existe = await codigoExiste(tabla, validacion.codigo, excluirId, client);
  if (existe) {
    throw { status: 409, mensaje: `El código ${validacion.codigo} ya está en uso` };
  }

  return validacion.codigo;
};

module.exports = {
  generarCodigo,
  validarCodigoManual,
  codigoExiste,
  resolverCodigo
};
