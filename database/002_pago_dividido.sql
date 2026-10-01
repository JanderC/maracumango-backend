-- ════════════════════════════════════════════════════════════════
--  PAGO DIVIDIDO — una venta cobrada en dos partes
--  (ej: 2.000 pesos en efectivo + el resto en bolívares por transferencia)
--  La parte 1 sigue en las columnas de siempre (moneda_pago, tipo_pago,
--  total_pagado, cuenta_bancaria_id). La parte 2 va en estas columnas,
--  que quedan en NULL para las ventas normales.
--  Idempotente: se puede ejecutar varias veces.
-- ════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS moneda_pago_2        VARCHAR(10),
  ADD COLUMN IF NOT EXISTS tipo_pago_2          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS total_pagado_2       NUMERIC(12,2),
  -- Equivalente en COP de la parte 2 (la parte 1 equivale a total_cop - total_cop_2)
  ADD COLUMN IF NOT EXISTS total_cop_2          NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS cuenta_bancaria_id_2 INTEGER REFERENCES cuentas_bancarias(id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ventas_pago_2_valido') THEN
    ALTER TABLE ventas ADD CONSTRAINT ventas_pago_2_valido CHECK (
      (moneda_pago_2 IS NULL AND tipo_pago_2 IS NULL AND total_pagado_2 IS NULL AND total_cop_2 IS NULL AND cuenta_bancaria_id_2 IS NULL)
      OR (moneda_pago_2 IN ('USD', 'BS', 'COP') AND tipo_pago_2 IN ('efectivo', 'transferencia')
          AND total_pagado_2 > 0 AND total_cop_2 > 0)
    );
  END IF;
END $$;

COMMIT;
