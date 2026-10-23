-- customers.account_owner_id and users.customer_id reference each other. Seed customers
-- first with account_owner_id NULL, then users, then set the owner.
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  customer_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  industry TEXT,
  tier TEXT NOT NULL DEFAULT 'mid_market' CHECK (tier IN ('enterprise','mid_market','small')),
  region TEXT,
  city TEXT,
  state TEXT,
  account_owner_id INTEGER REFERENCES users(id),
  annual_contract_value REAL,
  renewal_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','at_risk','churned')),
  customer_since TEXT,
  contact_email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','ops')),
  customer_id INTEGER REFERENCES customers(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_contacts (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  phone TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  line1 TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT,
  pincode TEXT,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  unit_price REAL NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  image_url TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  placed_by INTEGER NOT NULL REFERENCES users(id),
  address_id INTEGER REFERENCES customer_addresses(id),
  order_status TEXT NOT NULL DEFAULT 'placed'
    CHECK (order_status IN ('placed','confirmed','packed','shipped','delivered','cancelled')),
  total REAL NOT NULL DEFAULT 0,
  delivery_note TEXT,
  -- Connection the app had when the order was placed; 'offline_sync' = queued offline, synced later.
  client_network TEXT NOT NULL DEFAULT 'good' CHECK (client_network IN ('good','weak','offline_sync')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reported_by INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('delay','wrong_item','damaged','duplicate_order','billing','other')),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved')),
  description TEXT NOT NULL,
  jira_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_messages (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  issue_id INTEGER REFERENCES issues(id),
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_feedback (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_interactions (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id),
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('call','email','meeting','note','escalation','renewal')),
  summary TEXT NOT NULL,
  sentiment TEXT NOT NULL DEFAULT 'neutral' CHECK (sentiment IN ('positive','neutral','negative')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_reviews (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  order_id INTEGER REFERENCES orders(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (product_id, customer_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_messages_order ON order_messages(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_issues_order ON issues(order_id);
CREATE INDEX IF NOT EXISTS idx_interactions_customer ON customer_interactions(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contacts_customer ON customer_contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_addresses_customer ON customer_addresses(customer_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON product_reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_customer ON product_reviews(customer_id);

-- Views are dropped and recreated on every startup, so an existing data.db picks up
-- changes to their definitions without reseeding.
-- Issue counts: unresolved = open + investigating; open_issues_only = status exactly 'open'.
DROP VIEW IF EXISTS customer_summary;
CREATE VIEW customer_summary AS
SELECT c.id AS customer_id, c.name,
  (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS order_count,
  (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.customer_id = c.id AND o.order_status != 'cancelled') AS lifetime_value,
  (SELECT MAX(created_at) FROM orders o WHERE o.customer_id = c.id) AS last_order_at,
  (SELECT COUNT(*) FROM issues i JOIN orders o ON o.id = i.order_id WHERE o.customer_id = c.id AND i.status IN ('open','investigating')) AS unresolved_issues,
  (SELECT COUNT(*) FROM issues i JOIN orders o ON o.id = i.order_id WHERE o.customer_id = c.id AND i.status = 'open') AS open_issues_only,
  (SELECT COUNT(*) FROM issues i JOIN orders o ON o.id = i.order_id WHERE o.customer_id = c.id AND i.status = 'investigating') AS investigating_issues,
  (SELECT COUNT(*) FROM issues i JOIN orders o ON o.id = i.order_id WHERE o.customer_id = c.id) AS total_issues,
  (SELECT ROUND(AVG(f.rating),2) FROM order_feedback f JOIN orders o ON o.id = f.order_id WHERE o.customer_id = c.id) AS avg_rating,
  (SELECT COUNT(*) FROM customer_interactions x WHERE x.customer_id = c.id AND x.sentiment = 'negative') AS negative_interactions,
  (SELECT MAX(created_at) FROM customer_interactions x WHERE x.customer_id = c.id) AS last_interaction_at
FROM customers c;

DROP VIEW IF EXISTS customer_timeline;
CREATE VIEW customer_timeline AS
SELECT o.customer_id, 'order' AS event_type, o.created_at AS event_at, o.id AS order_id,
       'Order #' || o.id || ' placed, total ' || o.total
         || CASE WHEN o.client_network != 'good' THEN ' (client network: ' || o.client_network || ')' ELSE '' END
         AS summary
       FROM orders o
UNION ALL
SELECT o.customer_id, 'issue', i.created_at, o.id, i.category || ' (' || i.severity || '): ' || i.description
       FROM issues i JOIN orders o ON o.id = i.order_id
UNION ALL
SELECT o.customer_id, 'message', m.created_at, o.id, m.body
       FROM order_messages m JOIN orders o ON o.id = m.order_id
UNION ALL
SELECT o.customer_id, 'feedback', f.created_at, o.id, f.rating || '/5: ' || COALESCE(f.comment,'')
       FROM order_feedback f JOIN orders o ON o.id = f.order_id
UNION ALL
SELECT x.customer_id, x.interaction_type, x.created_at, x.order_id, x.summary FROM customer_interactions x;
