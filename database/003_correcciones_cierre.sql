-- ════════════════════════════════════════════════════════════════
--  CORRECCIONES DE CIERRE DE CAJA
--  Permite corregir lo contado (y las notas) de una caja ya cerrada.
--  Cada corrección queda registrada con los valores anteriores y los
--  nuevos, quién la hizo, cuándo y por qué. Nunca se borra el rastro.
--  Idempotente: se puede ejecutar varias veces.
-- ════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS caja_cierres_correcciones (
  id           SERIAL PRIMARY KEY,
  sesion_id    INTEGER NOT NULL REFERENCES caja_sesiones(id) ON DELETE CASCADE,
  motivo       TEXT NOT NULL,
  -- { contado_cop, contado_usd, contado_bs, notas_cierre } antes y después del cambio
  antes        JSONB NOT NULL,
  despues      JSONB NOT NULL,
  corregido_por INTEGER REFERENCES usuarios(id),
  corregido_en TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS caja_cierres_correcciones_sesion_idx ON caja_cierres_correcciones (sesion_id);

COMMIT;
