const pool = require('../../config/db');
const bcrypt = require('bcryptjs');

/* ════════════════════════════════════════════════════════════════
   MÓDULO DE CAJA
   - Sesión de caja: se abre con un fondo en COP/USD/BS y se cierra
     contando el efectivo. Lo esperado en caja por moneda es:
       apertura + ventas en efectivo + ingresos − egresos
     Las transferencias se reportan aparte (no entran al cajón).
   - Las ventas pertenecen a una sesión por rango de tiempo
     [abierta_en, cerrada_en) — solo hay una caja abierta a la vez.
   - Fechas guardadas en UTC (igual que ventas.creado_en); los días
     y semanas se calculan en hora de Venezuela.
   ════════════════════════════════════════════════════════════════ */

const TZ = 'America/Caracas';
const MONEDAS = ['COP', 'USD', 'BS'];
const TIPOS_PAGO = ['efectivo', 'transferencia'];

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Timestamp UTC guardado → ISO con "Z" para que el navegador lo muestre en su hora local
const iso = (col) => `to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
// Timestamp UTC guardado → fecha local (Venezuela)
const fechaLocal = (col) => `((${col}) AT TIME ZONE 'UTC' AT TIME ZONE '${TZ}')::date`;
// Fecha local (param) → inicio de ese día expresado en UTC
const inicioDiaUtc = (param) => `((${param})::date::timestamp AT TIME ZONE '${TZ}' AT TIME ZONE 'UTC')`;

const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

// Valida un monto de dinero ≥ 0 (vacío cuenta como 0)
const leerMonto = (valor, campo) => {
  if (valor === undefined || valor === null || valor === '') return 0;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) throw new ErrorValidacion(`El monto de ${campo} no es válido`);
  return r2(n);
};

class ErrorValidacion extends Error {}

// Reautenticación con contraseña para acciones destructivas.
// Responde 400 (no 401) para que el frontend no cierre la sesión del usuario.
const verificarContrasena = async (usuarioId, contrasena) => {
  if (!contrasena) throw new ErrorValidacion('Debes confirmar con tu contraseña');
  const u = await pool.query('SELECT contrasena FROM usuarios WHERE id = $1', [usuarioId]);
  if (u.rows.length === 0 || !(await bcrypt.compare(contrasena, u.rows[0].contrasena))) {
    throw new ErrorValidacion('Contraseña incorrecta');
  }
};

const manejarError = (res, err, contexto) => {
  if (err instanceof ErrorValidacion) return res.status(400).json({ mensaje: err.message });
  if (err.code === '23505' && /una_abierta/.test(err.constraint || '')) {
    return res.status(400).json({ mensaje: 'Ya hay una caja abierta' });
  }
  console.error(`Error ${contexto}:`, err.message);
  res.status(500).json({ mensaje: 'Error interno del servidor' });
};

/* ─── Cálculos reutilizables ─── */

const monedasVacias = (crear) => Object.fromEntries(MONEDAS.map(m => [m, crear()]));

// Ventas válidas (no anuladas) del rango [desde, hasta) agrupadas por moneda y tipo de pago
const resumenVentas = async (db, desde, hasta) => {
  const [grupos, totales] = await Promise.all([
    db.query(
      `SELECT moneda_pago AS moneda, tipo_pago,
              COUNT(*)::int AS cantidad,
              COALESCE(SUM(total_pagado), 0)::float AS total
         FROM ventas
        WHERE creado_en >= $1 AND creado_en < $2 AND COALESCE(anulada, false) = false
        GROUP BY 1, 2`,
      [desde, hasta]
    ),
    db.query(
      `SELECT COUNT(*) FILTER (WHERE NOT COALESCE(anulada, false))::int AS cantidad,
              COUNT(*) FILTER (WHERE COALESCE(anulada, false))::int      AS anuladas,
              COALESCE(SUM(total_cop) FILTER (WHERE NOT COALESCE(anulada, false)), 0)::float AS total_cop,
              COALESCE(SUM(total_usd) FILTER (WHERE NOT COALESCE(anulada, false)), 0)::float AS total_usd
         FROM ventas
        WHERE creado_en >= $1 AND creado_en < $2`,
      [desde, hasta]
    )
  ]);

  const por_moneda = monedasVacias(() => Object.fromEntries(TIPOS_PAGO.map(t => [t, { cantidad: 0, total: 0 }])));
  for (const g of grupos.rows) {
    if (por_moneda[g.moneda]?.[g.tipo_pago]) por_moneda[g.moneda][g.tipo_pago] = { cantidad: g.cantidad, total: r2(g.total) };
  }
  const t = totales.rows[0];
  return { por_moneda, cantidad: t.cantidad, anuladas: t.anuladas, total_cop: r2(t.total_cop), total_usd: r2(t.total_usd) };
};

// Suma de ingresos/egresos por moneda de una lista de movimientos
const totalesMovimientos = (movimientos) => {
  const tot = monedasVacias(() => ({ ingresos: 0, egresos: 0 }));
  for (const m of movimientos) {
    if (!tot[m.moneda]) continue;
    tot[m.moneda][m.tipo === 'ingreso' ? 'ingresos' : 'egresos'] += Number(m.monto);
  }
  for (const m of MONEDAS) { tot[m].ingresos = r2(tot[m].ingresos); tot[m].egresos = r2(tot[m].egresos); }
  return tot;
};

const SELECT_MOVIMIENTO = `
  SELECT m.id, m.sesion_id, m.tipo, m.moneda, m.monto::float AS monto, m.descripcion,
         ${iso('m.creado_en')} AS creado_en, u.nombre AS usuario
    FROM caja_movimientos m
    LEFT JOIN usuarios u ON u.id = m.usuario_id`;

const SELECT_SESION = `
  SELECT s.*, ${iso('s.abierta_en')} AS abierta_en_iso, ${iso('s.cerrada_en')} AS cerrada_en_iso,
         s.abierta_en::text AS desde_utc, COALESCE(s.cerrada_en, NOW())::text AS hasta_utc,
         ua.nombre AS abierta_por_nombre, uc.nombre AS cerrada_por_nombre
    FROM caja_sesiones s
    LEFT JOIN usuarios ua ON ua.id = s.abierta_por
    LEFT JOIN usuarios uc ON uc.id = s.cerrada_por`;

// Arma el estado completo de una sesión: ventas, movimientos y lo esperado por moneda
const calcularSesion = async (db, s) => {
  // Una caja cerrada usa la foto guardada al cerrarla (sigue siendo válida aunque
  // luego se eliminen las ventas de esa semana)
  if (s.estado === 'cerrada' && s.resumen_cierre) {
    const movs = await db.query(`${SELECT_MOVIMIENTO} WHERE m.sesion_id = $1 ORDER BY m.creado_en DESC`, [s.id]);
    const monedas = {};
    for (const m of MONEDAS) {
      const k = m.toLowerCase();
      const guardado = s.resumen_cierre.monedas[m];
      const contado = s[`contado_${k}`] === null ? null : r2(s[`contado_${k}`]);
      monedas[m] = { ...guardado, contado, diferencia: contado === null ? null : r2(contado - guardado.esperado) };
    }
    return formatoSesion(s, monedas, s.resumen_cierre.ventas, movs.rows);
  }

  const [ventas, movs] = await Promise.all([
    resumenVentas(db, s.desde_utc, s.hasta_utc),
    db.query(`${SELECT_MOVIMIENTO} WHERE m.sesion_id = $1 ORDER BY m.creado_en DESC`, [s.id])
  ]);
  const totMov = totalesMovimientos(movs.rows);
  const cerrada = s.estado === 'cerrada';

  const monedas = {};
  for (const m of MONEDAS) {
    const k = m.toLowerCase();
    const apertura = r2(s[`apertura_${k}`]);
    const ventas_efectivo = ventas.por_moneda[m].efectivo.total;
    const { ingresos, egresos } = totMov[m];
    const esperado = r2(apertura + ventas_efectivo + ingresos - egresos);
    const contado = cerrada && s[`contado_${k}`] !== null ? r2(s[`contado_${k}`]) : null;
    monedas[m] = {
      apertura,
      ventas_efectivo,
      cantidad_efectivo: ventas.por_moneda[m].efectivo.cantidad,
      transferencias: ventas.por_moneda[m].transferencia.total,
      cantidad_transferencias: ventas.por_moneda[m].transferencia.cantidad,
      ingresos,
      egresos,
      esperado,
      contado,
      diferencia: contado === null ? null : r2(contado - esperado)
    };
  }

  const resumenVentasSesion = { cantidad: ventas.cantidad, anuladas: ventas.anuladas, total_cop: ventas.total_cop, total_usd: ventas.total_usd };
  return formatoSesion(s, monedas, resumenVentasSesion, movs.rows);
};

const formatoSesion = (s, monedas, ventas, movimientos) => ({
  id: s.id,
  estado: s.estado,
  abierta_en: s.abierta_en_iso,
  abierta_por: s.abierta_por_nombre,
  cerrada_en: s.cerrada_en_iso,
  cerrada_por: s.cerrada_por_nombre,
  notas_apertura: s.notas_apertura,
  notas_cierre: s.notas_cierre,
  cierre_semanal_id: s.cierre_semanal_id,
  monedas,
  ventas,
  movimientos
});

// Límites UTC [desde, hasta) de N días locales a partir de una fecha local
const limitesDias = async (db, fecha, dias) => {
  const r = await db.query(
    `SELECT ${inicioDiaUtc('$1')}::text AS desde,
            ${inicioDiaUtc('$1::date + $2::int')}::text AS hasta,
            ($1::date + ($2::int - 1))::text AS fecha_fin,
            (NOW() AT TIME ZONE '${TZ}')::date::text AS hoy`,
    [fecha, dias]
  );
  return r.rows[0];
};

/* ════════════════════ SESIÓN ACTUAL ════════════════════ */

// GET /caja/actual — caja abierta (con cálculos) + lo contado en el último cierre
const obtenerCajaActual = async (req, res) => {
  try {
    const abierta = await pool.query(`${SELECT_SESION} WHERE s.estado = 'abierta' LIMIT 1`);
    const sesion = abierta.rows.length ? await calcularSesion(pool, abierta.rows[0]) : null;

    const ultimo = await pool.query(
      `SELECT s.id, ${iso('s.cerrada_en')} AS cerrada_en, u.nombre AS cerrada_por,
              s.contado_cop::float AS "COP", s.contado_usd::float AS "USD", s.contado_bs::float AS "BS"
         FROM caja_sesiones s LEFT JOIN usuarios u ON u.id = s.cerrada_por
        WHERE s.estado = 'cerrada'
        ORDER BY s.cerrada_en DESC LIMIT 1`
    );
    const u = ultimo.rows[0];
    res.json({
      sesion,
      ultimo_cierre: u ? { id: u.id, cerrada_en: u.cerrada_en, cerrada_por: u.cerrada_por, contado: { COP: u.COP, USD: u.USD, BS: u.BS } } : null
    });
  } catch (err) { manejarError(res, err, 'obteniendo caja actual'); }
};

// POST /caja/abrir
const abrirCaja = async (req, res) => {
  try {
    const apertura = {
      cop: leerMonto(req.body.apertura_cop, 'apertura COP'),
      usd: leerMonto(req.body.apertura_usd, 'apertura USD'),
      bs: leerMonto(req.body.apertura_bs, 'apertura BS')
    };
    const existe = await pool.query(`SELECT id FROM caja_sesiones WHERE estado = 'abierta'`);
    if (existe.rows.length) return res.status(400).json({ mensaje: 'Ya hay una caja abierta. Ciérrala antes de abrir otra' });

    const nueva = await pool.query(
      `INSERT INTO caja_sesiones (abierta_por, apertura_cop, apertura_usd, apertura_bs, notas_apertura)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.usuario.id, apertura.cop, apertura.usd, apertura.bs, req.body.notas?.trim() || null]
    );
    const s = await pool.query(`${SELECT_SESION} WHERE s.id = $1`, [nueva.rows[0].id]);
    res.status(201).json({ mensaje: 'Caja abierta', sesion: await calcularSesion(pool, s.rows[0]) });
  } catch (err) { manejarError(res, err, 'abriendo caja'); }
};

// POST /caja/cerrar — guarda lo esperado vs lo contado por moneda
const cerrarCaja = async (req, res) => {
  const client = await pool.connect();
  try {
    const contado = {
      COP: leerMonto(req.body.contado_cop, 'efectivo contado COP'),
      USD: leerMonto(req.body.contado_usd, 'efectivo contado USD'),
      BS: leerMonto(req.body.contado_bs, 'efectivo contado BS')
    };

    await client.query('BEGIN');
    const abierta = await client.query(`SELECT id FROM caja_sesiones WHERE estado = 'abierta' FOR UPDATE`);
    if (!abierta.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ mensaje: 'No hay una caja abierta' });
    }
    const id = abierta.rows[0].id;

    // Se fija la hora de cierre primero para que el cálculo use exactamente ese rango
    await client.query(`UPDATE caja_sesiones SET cerrada_en = NOW() WHERE id = $1`, [id]);
    const s = await client.query(`${SELECT_SESION} WHERE s.id = $1`, [id]);
    const calc = await calcularSesion(client, s.rows[0]);

    await client.query(
      `UPDATE caja_sesiones SET
         estado = 'cerrada', cerrada_por = $2,
         esperado_cop = $3, esperado_usd = $4, esperado_bs = $5,
         contado_cop = $6, contado_usd = $7, contado_bs = $8,
         notas_cierre = $9, resumen_cierre = $10
       WHERE id = $1`,
      [id, req.usuario.id,
        calc.monedas.COP.esperado, calc.monedas.USD.esperado, calc.monedas.BS.esperado,
        contado.COP, contado.USD, contado.BS,
        req.body.notas?.trim() || null,
        JSON.stringify({ monedas: calc.monedas, ventas: calc.ventas })]
    );
    await client.query('COMMIT');

    const final = await pool.query(`${SELECT_SESION} WHERE s.id = $1`, [id]);
    res.json({ mensaje: 'Caja cerrada', sesion: await calcularSesion(pool, final.rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    manejarError(res, err, 'cerrando caja');
  } finally { client.release(); }
};

/* ════════════════════ MOVIMIENTOS ════════════════════ */

// POST /caja/movimientos — ingreso o egreso de efectivo con descripción
const crearMovimiento = async (req, res) => {
  try {
    const { tipo, moneda, descripcion } = req.body;
    if (!['ingreso', 'egreso'].includes(tipo)) return res.status(400).json({ mensaje: 'Tipo inválido (ingreso o egreso)' });
    if (!MONEDAS.includes(moneda)) return res.status(400).json({ mensaje: 'Moneda inválida (COP, USD o BS)' });
    if (!descripcion || !descripcion.trim()) return res.status(400).json({ mensaje: 'Escribe una descripción del movimiento' });
    const monto = leerMonto(req.body.monto, 'movimiento');
    if (monto <= 0) return res.status(400).json({ mensaje: 'El monto debe ser mayor a 0' });

    const abierta = await pool.query(`SELECT id FROM caja_sesiones WHERE estado = 'abierta'`);
    if (!abierta.rows.length) return res.status(400).json({ mensaje: 'Abre la caja antes de registrar movimientos' });

    const ins = await pool.query(
      `INSERT INTO caja_movimientos (sesion_id, tipo, moneda, monto, descripcion, usuario_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [abierta.rows[0].id, tipo, moneda, monto, descripcion.trim(), req.usuario.id]
    );
    const mov = await pool.query(`${SELECT_MOVIMIENTO} WHERE m.id = $1`, [ins.rows[0].id]);
    res.status(201).json({ mensaje: tipo === 'ingreso' ? 'Ingreso registrado' : 'Egreso registrado', movimiento: mov.rows[0] });
  } catch (err) { manejarError(res, err, 'creando movimiento'); }
};

// DELETE /caja/movimientos/:id — solo admin y solo si la caja sigue abierta
const eliminarMovimiento = async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM caja_movimientos m USING caja_sesiones s
        WHERE m.id = $1 AND s.id = m.sesion_id AND s.estado = 'abierta'
        RETURNING m.id`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(400).json({ mensaje: 'Movimiento no encontrado o la caja ya fue cerrada' });
    res.json({ mensaje: 'Movimiento eliminado' });
  } catch (err) { manejarError(res, err, 'eliminando movimiento'); }
};

/* ════════════════════ HISTORIAL DE SESIONES ════════════════════ */

// GET /caja/sesiones?limite=50
const obtenerSesiones = async (req, res) => {
  try {
    const limite = Math.min(parseInt(req.query.limite, 10) || 50, 200);
    const r = await pool.query(
      `SELECT s.id, s.estado, ${iso('s.abierta_en')} AS abierta_en, ${iso('s.cerrada_en')} AS cerrada_en,
              ua.nombre AS abierta_por, uc.nombre AS cerrada_por, s.cierre_semanal_id,
              s.notas_apertura, s.notas_cierre,
              json_build_object(
                'COP', json_build_object('apertura', s.apertura_cop::float, 'esperado', s.esperado_cop::float, 'contado', s.contado_cop::float),
                'USD', json_build_object('apertura', s.apertura_usd::float, 'esperado', s.esperado_usd::float, 'contado', s.contado_usd::float),
                'BS',  json_build_object('apertura', s.apertura_bs::float,  'esperado', s.esperado_bs::float,  'contado', s.contado_bs::float)
              ) AS monedas,
              (SELECT COUNT(*)::int FROM caja_movimientos m WHERE m.sesion_id = s.id) AS movimientos
         FROM caja_sesiones s
         LEFT JOIN usuarios ua ON ua.id = s.abierta_por
         LEFT JOIN usuarios uc ON uc.id = s.cerrada_por
        ORDER BY s.abierta_en DESC
        LIMIT $1`,
      [limite]
    );
    res.json({ sesiones: r.rows });
  } catch (err) { manejarError(res, err, 'listando sesiones'); }
};

// GET /caja/sesiones/:id
const obtenerSesion = async (req, res) => {
  try {
    const s = await pool.query(`${SELECT_SESION} WHERE s.id = $1`, [req.params.id]);
    if (!s.rows.length) return res.status(404).json({ mensaje: 'Sesión no encontrada' });
    res.json({ sesion: await calcularSesion(pool, s.rows[0]) });
  } catch (err) { manejarError(res, err, 'obteniendo sesión'); }
};

/* ════════════════════ CONTABILIDAD DIARIA ════════════════════ */

// GET /caja/diario?fecha=YYYY-MM-DD (hora de Venezuela)
const obtenerDiario = async (req, res) => {
  try {
    let { fecha } = req.query;
    if (fecha && !esFecha(fecha)) return res.status(400).json({ mensaje: 'Fecha inválida (use AAAA-MM-DD)' });
    if (!fecha) fecha = (await pool.query(`SELECT (NOW() AT TIME ZONE '${TZ}')::date::text AS hoy`)).rows[0].hoy;
    const { desde, hasta } = await limitesDias(pool, fecha, 1);

    const [ventas, movs, sesiones, lista, fueraDeCaja] = await Promise.all([
      resumenVentas(pool, desde, hasta),
      pool.query(`${SELECT_MOVIMIENTO} WHERE m.creado_en >= $1 AND m.creado_en < $2 ORDER BY m.creado_en`, [desde, hasta]),
      pool.query(
        `${SELECT_SESION} WHERE s.abierta_en < $2 AND COALESCE(s.cerrada_en, NOW()) >= $1 ORDER BY s.abierta_en`,
        [desde, hasta]
      ),
      pool.query(
        `SELECT v.id, ${iso('v.creado_en')} AS creado_en, v.moneda_pago, v.tipo_pago,
                v.total_pagado::float AS total_pagado, v.total_cop::float AS total_cop,
                COALESCE(v.anulada, false) AS anulada, u.nombre AS cajero
           FROM ventas v LEFT JOIN usuarios u ON u.id = v.usuario_id
          WHERE v.creado_en >= $1 AND v.creado_en < $2
          ORDER BY v.creado_en DESC`,
        [desde, hasta]
      ),
      // Ventas en efectivo hechas sin ninguna caja abierta (no quedan cuadradas en ninguna sesión)
      pool.query(
        `SELECT COUNT(*)::int AS cantidad FROM ventas v
          WHERE v.creado_en >= $1 AND v.creado_en < $2 AND v.tipo_pago = 'efectivo'
            AND NOT COALESCE(v.anulada, false)
            AND NOT EXISTS (SELECT 1 FROM caja_sesiones s
                             WHERE v.creado_en >= s.abierta_en AND v.creado_en < COALESCE(s.cerrada_en, NOW()))`,
        [desde, hasta]
      )
    ]);

    res.json({
      fecha,
      ventas,
      movimientos: movs.rows,
      totales_movimientos: totalesMovimientos(movs.rows),
      sesiones: await Promise.all(sesiones.rows.map(s => calcularSesion(pool, s))),
      lista_ventas: lista.rows,
      efectivo_fuera_de_caja: fueraDeCaja.rows[0].cantidad
    });
  } catch (err) { manejarError(res, err, 'obteniendo contabilidad diaria'); }
};

/* ════════════════════ CIERRE SEMANAL ════════════════════ */

// Resumen de 7 días (o los indicados) a partir de fecha_inicio + validaciones para cerrar
const construirResumenSemana = async (db, fecha_inicio) => {
  const { desde, hasta, fecha_fin, hoy } = await limitesDias(db, fecha_inicio, 7);

  const [ventas, porDia, movs, sesiones, solapados] = await Promise.all([
    resumenVentas(db, desde, hasta),
    db.query(
      `SELECT ${fechaLocal('creado_en')}::text AS fecha,
              COUNT(*) FILTER (WHERE NOT COALESCE(anulada, false))::int AS cantidad,
              COUNT(*) FILTER (WHERE COALESCE(anulada, false))::int AS anuladas,
              COALESCE(SUM(total_cop) FILTER (WHERE NOT COALESCE(anulada, false)), 0)::float AS total_cop,
              COALESCE(SUM(total_usd) FILTER (WHERE NOT COALESCE(anulada, false)), 0)::float AS total_usd,
              COALESCE(SUM(total_pagado) FILTER (WHERE moneda_pago = 'COP' AND NOT COALESCE(anulada, false)), 0)::float AS "COP",
              COALESCE(SUM(total_pagado) FILTER (WHERE moneda_pago = 'USD' AND NOT COALESCE(anulada, false)), 0)::float AS "USD",
              COALESCE(SUM(total_pagado) FILTER (WHERE moneda_pago = 'BS'  AND NOT COALESCE(anulada, false)), 0)::float AS "BS"
         FROM ventas WHERE creado_en >= $1 AND creado_en < $2
        GROUP BY 1 ORDER BY 1`,
      [desde, hasta]
    ),
    db.query(`SELECT tipo, moneda, monto::float AS monto FROM caja_movimientos WHERE creado_en >= $1 AND creado_en < $2`, [desde, hasta]),
    db.query(
      `SELECT estado,
              COALESCE(contado_cop - esperado_cop, 0)::float AS dif_cop,
              COALESCE(contado_usd - esperado_usd, 0)::float AS dif_usd,
              COALESCE(contado_bs  - esperado_bs, 0)::float  AS dif_bs
         FROM caja_sesiones WHERE abierta_en >= $1 AND abierta_en < $2`,
      [desde, hasta]
    ),
    db.query(
      `SELECT id, fecha_inicio::text, fecha_fin::text FROM caja_cierres_semanales
        WHERE fecha_inicio <= $2::date AND fecha_fin >= $1::date`,
      [fecha_inicio, fecha_fin]
    )
  ]);

  const diferencias = { COP: 0, USD: 0, BS: 0 };
  for (const s of sesiones.rows) { diferencias.COP += s.dif_cop; diferencias.USD += s.dif_usd; diferencias.BS += s.dif_bs; }
  MONEDAS.forEach(m => { diferencias[m] = r2(diferencias[m]); });
  const abiertas = sesiones.rows.filter(s => s.estado === 'abierta').length;

  const bloqueos = [];
  if (solapados.rows.length) {
    const c = solapados.rows[0];
    bloqueos.push(`Ya existe un cierre semanal que cubre esas fechas (${c.fecha_inicio} al ${c.fecha_fin})`);
  }
  if (abiertas) bloqueos.push('Hay una caja abierta dentro de la semana. Ciérrala primero');
  if (fecha_inicio > hoy) bloqueos.push('La semana todavía no ha comenzado');

  return {
    resumen: {
      fecha_inicio, fecha_fin,
      ventas,
      por_dia: porDia.rows.map(d => ({ ...d, total_cop: r2(d.total_cop), total_usd: r2(d.total_usd), COP: r2(d.COP), USD: r2(d.USD), BS: r2(d.BS) })),
      movimientos: totalesMovimientos(movs.rows),
      sesiones: { cantidad: sesiones.rows.length, abiertas, diferencias }
    },
    semana_en_curso: fecha_fin >= hoy,
    bloqueos,
    limites: { desde, hasta }
  };
};

// GET /caja/semanal/preview?fecha_inicio=YYYY-MM-DD
const previewSemana = async (req, res) => {
  try {
    const { fecha_inicio } = req.query;
    if (!esFecha(fecha_inicio)) return res.status(400).json({ mensaje: 'Indica fecha_inicio (AAAA-MM-DD)' });
    const r = await construirResumenSemana(pool, fecha_inicio);
    res.json({ resumen: r.resumen, semana_en_curso: r.semana_en_curso, bloqueos: r.bloqueos, puede_cerrar: r.bloqueos.length === 0 });
  } catch (err) { manejarError(res, err, 'calculando semana'); }
};

// POST /caja/semanal/cerrar  { fecha_inicio, notas }
const cerrarSemana = async (req, res) => {
  const client = await pool.connect();
  try {
    const { fecha_inicio, notas } = req.body;
    if (!esFecha(fecha_inicio)) return res.status(400).json({ mensaje: 'Indica fecha_inicio (AAAA-MM-DD)' });

    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('caja_cierre_semanal'))`);
    const r = await construirResumenSemana(client, fecha_inicio);
    if (r.bloqueos.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ mensaje: r.bloqueos[0], bloqueos: r.bloqueos });
    }

    const ins = await client.query(
      `INSERT INTO caja_cierres_semanales (fecha_inicio, fecha_fin, resumen, notas, cerrado_por)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [r.resumen.fecha_inicio, r.resumen.fecha_fin, JSON.stringify(r.resumen), notas?.trim() || null, req.usuario.id]
    );
    await client.query(
      `UPDATE caja_sesiones SET cierre_semanal_id = $1 WHERE abierta_en >= $2 AND abierta_en < $3`,
      [ins.rows[0].id, r.limites.desde, r.limites.hasta]
    );
    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Semana cerrada correctamente', id: ins.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    manejarError(res, err, 'cerrando semana');
  } finally { client.release(); }
};

// GET /caja/semanal
const obtenerCierresSemanales = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.id, c.fecha_inicio::text, c.fecha_fin::text, c.resumen, c.notas,
              ${iso('c.cerrado_en')} AS cerrado_en, u.nombre AS cerrado_por,
              c.ventas_eliminadas, ${iso('c.ventas_eliminadas_en')} AS ventas_eliminadas_en,
              ue.nombre AS ventas_eliminadas_por, c.total_ventas_eliminadas,
              (SELECT COUNT(*)::int FROM ventas v
                WHERE ${fechaLocal('v.creado_en')} BETWEEN c.fecha_inicio AND c.fecha_fin) AS ventas_en_bd
         FROM caja_cierres_semanales c
         LEFT JOIN usuarios u  ON u.id  = c.cerrado_por
         LEFT JOIN usuarios ue ON ue.id = c.ventas_eliminadas_por
        ORDER BY c.fecha_inicio DESC`
    );
    res.json({ cierres: r.rows });
  } catch (err) { manejarError(res, err, 'listando cierres semanales'); }
};

// DELETE /caja/semanal/:id/ventas  { contrasena, confirmacion: 'ELIMINAR' }
// Borra definitivamente las ventas de los 7 días del cierre. El resumen del cierre se conserva.
const eliminarVentasSemana = async (req, res) => {
  const client = await pool.connect();
  try {
    const { contrasena, confirmacion } = req.body || {};
    if (confirmacion !== 'ELIMINAR') return res.status(400).json({ mensaje: 'Escribe ELIMINAR para confirmar' });
    await verificarContrasena(req.usuario.id, contrasena);

    await client.query('BEGIN');
    const c = await client.query(
      `SELECT id, fecha_inicio::text, fecha_fin::text FROM caja_cierres_semanales WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!c.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ mensaje: 'Cierre semanal no encontrado' });
    }
    const { fecha_inicio, fecha_fin } = c.rows[0];
    // items_venta e items_venta_toppings se borran en cascada; stock_alertas queda con venta_id NULL
    const del = await client.query(
      `DELETE FROM ventas WHERE ${fechaLocal('creado_en')} BETWEEN $1::date AND $2::date`,
      [fecha_inicio, fecha_fin]
    );
    await client.query(
      `UPDATE caja_cierres_semanales SET
         ventas_eliminadas = true, ventas_eliminadas_en = NOW(), ventas_eliminadas_por = $2,
         total_ventas_eliminadas = COALESCE(total_ventas_eliminadas, 0) + $3
       WHERE id = $1`,
      [req.params.id, req.usuario.id, del.rowCount]
    );
    await client.query('COMMIT');
    res.json({ mensaje: `Se eliminaron ${del.rowCount} ventas del ${fecha_inicio} al ${fecha_fin}`, eliminadas: del.rowCount });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    manejarError(res, err, 'eliminando ventas de la semana');
  } finally { client.release(); }
};

// DELETE /caja/semanal/:id  { contrasena } — elimina el registro del cierre (reabre la semana)
const eliminarCierreSemanal = async (req, res) => {
  try {
    await verificarContrasena(req.usuario.id, req.body?.contrasena);
    const r = await pool.query(`DELETE FROM caja_cierres_semanales WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ mensaje: 'Cierre semanal no encontrado' });
    res.json({ mensaje: 'Cierre semanal eliminado' });
  } catch (err) { manejarError(res, err, 'eliminando cierre semanal'); }
};

module.exports = {
  obtenerCajaActual,
  abrirCaja,
  cerrarCaja,
  crearMovimiento,
  eliminarMovimiento,
  obtenerSesiones,
  obtenerSesion,
  obtenerDiario,
  previewSemana,
  cerrarSemana,
  obtenerCierresSemanales,
  eliminarVentasSemana,
  eliminarCierreSemanal
};
