-- Slice 6 (29 Oct 2026): a paid order is locked at database level. Once "lockedAt" is set, no UPDATE or DELETE
-- reaches the row — not from the MD, not from a script. Like the audit trail, this is a trigger, not a convention.
CREATE OR REPLACE FUNCTION payment_refuse_change() RETURNS trigger AS $$
BEGIN
  IF OLD."lockedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Payment % is paid and locked', OLD."number";
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_locked
  BEFORE UPDATE OR DELETE ON "PaymentRequest"
  FOR EACH ROW EXECUTE FUNCTION payment_refuse_change();
