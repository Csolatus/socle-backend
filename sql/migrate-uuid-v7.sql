-- One-time upgrade of the earlier lesson data. Back up the database first.
-- Changes identifiers and their foreign keys, not business data.
-- Prints the ID mapping so external references can be updated.
BEGIN;
LOCK TABLE users, venues, events, reservations IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE id_migration (
  entity text NOT NULL,
  old_id uuid NOT NULL,
  new_id uuid NOT NULL,
  PRIMARY KEY (entity, old_id)
) ON COMMIT DROP;

INSERT INTO id_migration (entity, old_id, new_id)
SELECT entity, id,
  CASE id::text
    WHEN '11111111-1111-4111-8111-111111111111' THEN '01900000-0000-7000-8000-000000000001'::uuid
    WHEN '22222222-2222-4222-8222-222222222222' THEN '01900000-0000-7000-8000-000000000002'::uuid
    WHEN '33333333-3333-4333-8333-333333333333' THEN '01900000-0000-7000-8000-000000000003'::uuid
    WHEN '44444444-4444-4444-8444-444444444444' THEN '01900000-0000-7000-8000-000000000004'::uuid
    ELSE (
      substr(timestamp_hex, 1, 8) || '-' || substr(timestamp_hex, 9, 4) || '-7' ||
      substr(random_uuid, 16, 3) || '-' || substr(random_uuid, 20, 18)
    )::uuid
  END
FROM (
  SELECT 'users' AS entity, id FROM users
  UNION ALL SELECT 'venues', id FROM venues
  UNION ALL SELECT 'events', id FROM events
  UNION ALL SELECT 'reservations', id FROM reservations
) AS records
CROSS JOIN LATERAL (
  SELECT lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') AS timestamp_hex,
    gen_random_uuid()::text AS random_uuid
  WHERE records.id IS NOT NULL
) AS generated
WHERE id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

-- Temporarily defer FKs so parent and child IDs can change in one transaction.
-- Remember their original settings instead of changing the schema permanently.
CREATE TEMP TABLE migration_foreign_keys ON COMMIT DROP AS
SELECT conrelid::regclass AS table_name, conname, condeferrable, condeferred
FROM pg_constraint
WHERE contype = 'f' AND conrelid IN ('events'::regclass, 'reservations'::regclass);

DO $$
DECLARE fk record;
BEGIN
  FOR fk IN SELECT * FROM migration_foreign_keys LOOP
    EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY DEFERRED', fk.table_name, fk.conname);
  END LOOP;
END $$;
SET CONSTRAINTS ALL DEFERRED;

UPDATE users u SET id = m.new_id FROM id_migration m WHERE m.entity = 'users' AND u.id = m.old_id;
UPDATE venues v SET id = m.new_id FROM id_migration m WHERE m.entity = 'venues' AND v.id = m.old_id;
UPDATE events e SET id = m.new_id FROM id_migration m WHERE m.entity = 'events' AND e.id = m.old_id;
UPDATE events e SET venue_id = m.new_id FROM id_migration m WHERE m.entity = 'venues' AND e.venue_id = m.old_id;
UPDATE reservations r SET id = m.new_id FROM id_migration m WHERE m.entity = 'reservations' AND r.id = m.old_id;
UPDATE reservations r SET event_id = m.new_id FROM id_migration m WHERE m.entity = 'events' AND r.event_id = m.old_id;
UPDATE reservations r SET user_id = m.new_id FROM id_migration m WHERE m.entity = 'users' AND r.user_id = m.old_id;

SET CONSTRAINTS ALL IMMEDIATE;
DO $$
DECLARE fk record;
BEGIN
  FOR fk IN SELECT * FROM migration_foreign_keys LOOP
    EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I %s', fk.table_name, fk.conname,
      CASE WHEN NOT fk.condeferrable THEN 'NOT DEFERRABLE'
           WHEN fk.condeferred THEN 'DEFERRABLE INITIALLY DEFERRED'
           ELSE 'DEFERRABLE INITIALLY IMMEDIATE' END);
  END LOOP;
END $$;

SELECT entity, old_id, new_id FROM id_migration ORDER BY entity, old_id;
COMMIT;
