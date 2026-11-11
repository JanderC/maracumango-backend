-- ════════════════════════════════════════════════════════════════
--  VUELTO EN OTRA MONEDA
--  Ej: el cliente paga 9 dólares con un billete de 20 y el vuelto
--  (11 dólares) se le entrega en pesos (33.000). Así la caja sabe que
--  en la gaveta de dólares quedaron los 20 y que de la de pesos
--  salieron 33.000.
--  vuelto_moneda NULL = el vuelto se entregó en la misma moneda del pago
--  vuelto_entregado   = monto del vuelto en vuelto_moneda
--  Idempotente: se puede ejecutar varias veces.
-- ════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS vuelto_moneda    VARCHAR(10),
  ADD COLUMN IF NOT EXISTS vuelto_entregado NUMERIC(14,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ventas_vuelto_moneda_valido') THEN
    ALTER TABLE ventas ADD CONSTRAINT ventas_vuelto_moneda_valido CHECK (
      (vuelto_moneda IS NULL AND vuelto_entregado IS NULL)
      OR (vuelto_moneda IN ('USD', 'BS', 'COP') AND vuelto_moneda <> moneda_pago AND vuelto_entregado > 0)
    );
  END IF;
END $$;

COMMIT;
