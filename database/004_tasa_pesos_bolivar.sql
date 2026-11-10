-- ════════════════════════════════════════════════════════════════
--  TASA PESOS POR BOLÍVAR
--  El negocio maneja el bolívar como "pesos por 1 Bs" (ej. 2.85), con dos
--  decimales. Se guarda como moneda 'COP_BS' en tasas_cambio; para esa
--  moneda la columna tasa_por_usd significa "pesos por 1 bolívar".
--  El punto de venta deriva la tasa BS/USD = tasa COP / pesos por Bs.
--  Idempotente: se puede ejecutar varias veces.
-- ════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE tasas_cambio DROP CONSTRAINT IF EXISTS tasas_cambio_moneda_check;
ALTER TABLE tasas_cambio ADD CONSTRAINT tasas_cambio_moneda_check
  CHECK (moneda IN ('BS', 'COP', 'COP_BS'));

COMMIT;
