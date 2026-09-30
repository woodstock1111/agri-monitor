-- Accounts move from app-state.json to the users/tenants tables created in 001 (imported once at startup when empty).
-- One account, several ways to sign in: the password stays on users; each WeChat mini program openid is a user_identities row.
-- Sessions are server-side: the table keeps sha256(token), never the token itself. See docs/auth-design.md.

ALTER TABLE users ADD COLUMN phone text UNIQUE;

CREATE TABLE user_identities (
    id           text PRIMARY KEY,
    user_id      text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider     text        NOT NULL CHECK (provider IN ('wechat_mini')),
    provider_uid text        NOT NULL,              -- openid
    unionid      text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    UNIQUE (provider, provider_uid)                 -- one WeChat can belong to one account only
);
CREATE INDEX user_identities_user ON user_identities (user_id);

-- A session belongs to an account, or (mini program guests) only to a WeChat openid: guests may use public-data APIs
-- such as harvest soil/weather, never farm data.
CREATE TABLE sessions (
    id            text PRIMARY KEY,                 -- hex sha256 of the session token
    user_id       text        REFERENCES users(id) ON DELETE CASCADE,
    wechat_openid text,
    client        text        NOT NULL CHECK (client IN ('web', 'miniprogram')),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    ip         text,
    user_agent text,
    CHECK (user_id IS NOT NULL OR (wechat_openid IS NOT NULL AND client = 'miniprogram'))
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);
