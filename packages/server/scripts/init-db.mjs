/**
 * 初始化数据库表（幂等）
 *
 * 运行：`pnpm --filter idle-dark-server db:init`
 *
 * 只创建本工程当前需要的三张表：users / account_state / characters。
 * 全部使用 `IF NOT EXISTS` + 增量 `ALTER ... ADD COLUMN IF NOT EXISTS`，可重复执行。
 */
import 'dotenv/config';
import pg from 'pg';

const connectionString =
  process.env.DATABASE_URL && process.env.DATABASE_URL !== ''
    ? process.env.DATABASE_URL
    : `postgresql://${process.env.DB_USER ?? 'postgres'}:${process.env.DB_PASSWORD ?? 'postgres'}@${process.env.DB_HOST ?? 'localhost'}:${process.env.DB_PORT ?? '5432'}/${process.env.DB_NAME ?? 'idle_dark'}`;

const client = new pg.Client({ connectionString });

const sql = `
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS account_state (
  user_id               BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  diamonds              INTEGER NOT NULL DEFAULT 0,
  player_slot_count     INTEGER NOT NULL DEFAULT 1,
  highest_endless_level INTEGER NOT NULL DEFAULT 0,
  data                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS characters (
  id             TEXT PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'warrior',
  career         TEXT NOT NULL DEFAULT 'warrior',
  level          INTEGER NOT NULL DEFAULT 1,
  state          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_settle_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_characters_user_id ON characters(user_id);

-- 兼容已有库：增量补列（幂等）
ALTER TABLE users           ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE account_state   ADD COLUMN IF NOT EXISTS diamonds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE account_state   ADD COLUMN IF NOT EXISTS player_slot_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE account_state   ADD COLUMN IF NOT EXISTS highest_endless_level INTEGER NOT NULL DEFAULT 0;
ALTER TABLE account_state   ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE characters      ADD COLUMN IF NOT EXISTS state JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE characters      ADD COLUMN IF NOT EXISTS last_settle_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- W3：删除巅峰等级设定（列不再落库 / 不再读取）
ALTER TABLE characters      DROP COLUMN IF EXISTS peak_level;
`;

try {
  await client.connect();
  await client.query(sql);
  console.log('[idle-dark-forever] database initialized (users / account_state / characters)');
} finally {
  await client.end();
}
