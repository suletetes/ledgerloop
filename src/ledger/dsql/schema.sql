-- LedgerLoop DSQL-safe DDL
-- DSQL constraints: NO foreign keys, NO sequences, NO triggers, NO views, NO JSON columns.
-- All PKs are application-generated UUIDs. Money is BIGINT minor units (INV-4).
-- Secondary indexes use CREATE INDEX ASYNC (plain CREATE INDEX is unsupported in DSQL).

-- Reference state. PII limited to display_name, email, home_region (Req 21.2).
CREATE TABLE users (
  id            UUID PRIMARY KEY,
  display_name  TEXT NOT NULL,
  email         TEXT NOT NULL,
  home_region   TEXT NOT NULL,
  currency_pref CHAR(3) NOT NULL DEFAULT 'USD',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE groups (
  id            UUID PRIMARY KEY,
  name          TEXT NOT NULL,
  base_currency CHAR(3) NOT NULL DEFAULT 'USD',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
  id        UUID PRIMARY KEY,
  group_id  UUID NOT NULL,
  user_id   UUID NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC idx_members_group ON group_members (group_id);
CREATE INDEX ASYNC idx_members_user  ON group_members (user_id);
-- Unique membership prevents duplicate joins (Req 4.2, 13.4 / INV-6).
CREATE UNIQUE INDEX ASYNC idx_members_uniq ON group_members (group_id, user_id);

-- Append-only ledger. Never UPDATE; corrections are new reversing rows (Req 6.6, 6.7).
CREATE TABLE expenses (
  id           UUID PRIMARY KEY,
  group_id     UUID NOT NULL,
  paid_by      UUID NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency     CHAR(3) NOT NULL,
  description  TEXT NOT NULL,
  split_type   TEXT NOT NULL CHECK (split_type IN ('equal','percent','exact')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC idx_expenses_group ON expenses (group_id);

CREATE TABLE expense_splits (
  id          UUID PRIMARY KEY,
  expense_id  UUID NOT NULL,
  user_id     UUID NOT NULL,
  share_minor BIGINT NOT NULL CHECK (share_minor >= 0)
);
CREATE INDEX ASYNC idx_splits_expense ON expense_splits (expense_id);

CREATE TABLE settlements (
  id           UUID PRIMARY KEY,
  group_id     UUID NOT NULL,
  from_user    UUID NOT NULL,
  to_user      UUID NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency     CHAR(3) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC idx_settlements_group ON settlements (group_id);
