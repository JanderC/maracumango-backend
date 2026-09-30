-- ════════════════════════════════════════════════════════════════
--  Módulo de CAJA — Maracu Mango
--  Sesiones de caja (apertura/cierre) en COP, USD y BS, movimientos
--  manuales (ingresos/egresos) y cierres semanales.
--  Idempotente: se puede ejecutar varias veces sin romper nada.
--  Fechas en UTC (igual que ventas.creado_en); la agrupación por día
--  se hace en hora de Venezuela (America/Caracas) desde el backend.
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- Cierres semanales: foto (resumen JSON) de 7 días de operación.
CREATE TABLE IF NOT EXISTS caja_cierres_semanales (
  id                     SERIAL PRIMARY KEY,
  fecha_inicio           DATE NOT NULL,
  fecha_fin              DATE NOT NULL,
  resumen                JSONB NOT NULL,
  notas                  TEXT,
  cerrado_por            INTEGER REFERENCES usuarios(id),
  cerrado_en             TIMESTAMP NOT NULL DEFAULT NOW(),
  ventas_eliminadas      BOOLEAN NOT NULL DEFAULT false,
  ventas_eliminadas_en   TIMESTAMP,
  ventas_eliminadas_por  INTEGER REFERENCES usuarios(id),
  total_ventas_eliminadas INTEGER,
  CONSTRAINT caja_cierres_rango_valido CHECK (fecha_fin >= fecha_inicio)
);

-- Una sesión = desde que se abre la caja hasta que se cierra.
CREATE TABLE IF NOT EXISTS caja_sesiones (
  id                 SERIAL PRIMARY KEY,
  estado             VARCHAR(10) NOT NULL DEFAULT 'abierta'
                       CONSTRAINT caja_sesiones_estado_valido CHECK (estado IN ('abierta', 'cerrada')),
  abierta_por        INTEGER REFERENCES usuarios(id),
  abierta_en         TIMESTAMP NOT NULL DEFAULT NOW(),
  apertura_cop       NUMERIC(14,2) NOT NULL DEFAULT 0,
  apertura_usd       NUMERIC(14,2) NOT NULL DEFAULT 0,
  apertura_bs        NUMERIC(14,2) NOT NULL DEFAULT 0,
  notas_apertura     TEXT,
  cerrada_por        INTEGER REFERENCES usuarios(id),
  cerrada_en         TIMESTAMP,
  esperado_cop       NUMERIC(14,2),
  esperado_usd       NUMERIC(14,2),
  esperado_bs        NUMERIC(14,2),
  contado_cop        NUMERIC(14,2),
  contado_usd        NUMERIC(14,2),
  contado_bs         NUMERIC(14,2),
  notas_cierre       TEXT,
  resumen_cierre     JSONB,
  cierre_semanal_id  INTEGER REFERENCES caja_cierres_semanales(id) ON DELETE SET NULL
);

-- Solo puede haber UNA caja abierta a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS caja_sesiones_una_abierta
  ON caja_sesiones ((estado)) WHERE estado = 'abierta';
CREATE INDEX IF NOT EXISTS caja_sesiones_abierta_en_idx ON caja_sesiones (abierta_en);

-- Ingresos / egresos manuales de efectivo (retiros, pagos a proveedores, fondos, etc.)
CREATE TABLE IF NOT EXISTS caja_movimientos (
  id           SERIAL PRIMARY KEY,
  sesion_id    INTEGER NOT NULL REFERENCES caja_sesiones(id) ON DELETE CASCADE,
  tipo         VARCHAR(10) NOT NULL
                 CONSTRAINT caja_movimientos_tipo_valido CHECK (tipo IN ('ingreso', 'egreso')),
  moneda       VARCHAR(3) NOT NULL
                 CONSTRAINT caja_movimientos_moneda_valida CHECK (moneda IN ('COP', 'USD', 'BS')),
  monto        NUMERIC(14,2) NOT NULL CONSTRAINT caja_movimientos_monto_positivo CHECK (monto > 0),
  descripcion  TEXT NOT NULL,
  usuario_id   INTEGER REFERENCES usuarios(id),
  creado_en    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS caja_movimientos_sesion_idx ON caja_movimientos (sesion_id);
CREATE INDEX IF NOT EXISTS caja_movimientos_creado_en_idx ON caja_movimientos (creado_en);

-- Acelera los resúmenes por rango de fechas
CREATE INDEX IF NOT EXISTS ventas_creado_en_idx ON ventas (creado_en);

COMMIT;
