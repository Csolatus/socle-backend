BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS venues (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  address text NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  category text NOT NULL CHECK (length(trim(category)) > 0),
  starts_at timestamptz NOT NULL,
  capacity integer NOT NULL CHECK (capacity > 0),
  venue_id uuid NOT NULL REFERENCES venues(id)
);
CREATE INDEX IF NOT EXISTS events_starts_at_idx ON events(starts_at);
CREATE INDEX IF NOT EXISTS events_category_starts_at_idx ON events(category, starts_at);

CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id),
  user_id uuid NOT NULL REFERENCES users(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);
CREATE INDEX IF NOT EXISTS reservations_event_id_idx ON reservations(event_id);
CREATE INDEX IF NOT EXISTS reservations_user_id_idx ON reservations(user_id);

INSERT INTO users (id, name, email) VALUES
  ('01900000-0000-7000-8000-000000000001', 'Alice', 'alice@example.com'),
  ('01900000-0000-7000-8000-000000000002', 'Bob', 'bob@example.com')
ON CONFLICT DO NOTHING;
INSERT INTO venues (id, name, address) VALUES
  ('01900000-0000-7000-8000-000000000003', 'Game room', '12 rue du Jeu, Paris')
ON CONFLICT DO NOTHING;
INSERT INTO events (id, title, category, starts_at, capacity, venue_id) VALUES
  ('01900000-0000-7000-8000-000000000004', 'Board game night', 'gaming', '2099-06-15T18:00:00Z', 20,
   '01900000-0000-7000-8000-000000000003')
ON CONFLICT DO NOTHING;

COMMIT;
