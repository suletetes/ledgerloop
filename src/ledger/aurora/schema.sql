-- LedgerLoop Aurora PostgreSQL DDL
-- Standard PostgreSQL with foreign keys enforced at the DB level.
-- All PKs are application-generated UUIDs. Money is BIGINT minor units (INV-4).
-- Transaction isolation set to SERIALIZABLE for OCC (40001) behavior.

-- Reference state. PII limited to display_name, email, home_region (Req 21.2).
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY,
  display_name  TEXT NOT NULL,
  email         TEXT NOT NULL,
  home_region   TEXT NOT NULL,
  currency_pref CHAR(3) NOT NULL DEFAULT 'USD',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS groups (
  id            UUID PRIMARY KEY,
  name          TEXT NOT NULL,
  base_currency CHAR(3) NOT NULL DEFAULT 'USD',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_members (
  id        UUID PRIMARY KEY,
  group_id  UUID NOT NULL REFERENCES groups(id),
  user_id   UUID NOT NULL REFERENCES users(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_group ON group_members (group_id);
CREATE INDEX IF NOT EXISTS idx_members_user  ON group_members (user_id);

-- Append-only ledger. Never UPDATE; corrections are new reversing rows (Req 6.6, 6.7).
CREATE TABLE IF NOT EXISTS expenses (
  id           UUID PRIMARY KEY,
  group_id     UUID NOT NULL REFERENCES groups(id),
  paid_by      UUID NOT NULL REFERENCES users(id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency     CHAR(3) NOT NULL,
  description  TEXT NOT NULL,
  split_type   TEXT NOT NULL CHECK (split_type IN ('equal','percent','exact')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses (group_id);

CREATE TABLE IF NOT EXISTS expense_splits (
  id          UUID PRIMARY KEY,
  expense_id  UUID NOT NULL REFERENCES expenses(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  share_minor BIGINT NOT NULL CHECK (share_minor >= 0)
);
CREATE INDEX IF NOT EXISTS idx_splits_expense ON expense_splits (expense_id);

CREATE TABLE IF NOT EXISTS settlements (
  id           UUID PRIMARY KEY,
  group_id     UUID NOT NULL REFERENCES groups(id),
  from_user    UUID NOT NULL REFERENCES users(id),
  to_user      UUID NOT NULL REFERENCES users(id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency     CHAR(3) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_settlements_group ON settlements (group_id);

-- Set default transaction isolation to SERIALIZABLE for OCC (SQLSTATE 40001)
ALTER DATABASE ledgerloop SET default_transaction_isolation = 'serializable';
