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
