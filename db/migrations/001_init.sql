-- Phase 1 (live): sensor readings, crops, photos, photo regions, region embeddings, pest library.
-- Phase 2 (created now, not used yet — app-state.json / farm-tasks.json remain the source of truth):
--   tenants, users, locations, devices, channels, farm_tasks, audit_log.
-- Must stay compatible with PostgreSQL 16 + pgvector 0.6 (production).
-- The vector extension is created by the setup step as a superuser, not here.

-- ---------------------------------------------------------------- phase 1

CREATE TABLE sensor_readings (
    id                bigserial PRIMARY KEY,
    tenant_id         text        NOT NULL,
    device_id         text        NOT NULL,
    provider          text        NOT NULL,
    ts                timestamptz NOT NULL,              -- time reported by the device
    slot_at           timestamptz,                       -- hour slot this row was stored for; null for history-sync/migrated
    is_daily_snapshot boolean     NOT NULL DEFAULT false, -- 08:00 / 14:00 Beijing time
    kind              text        NOT NULL CHECK (kind IN ('hourly', 'history_sync', 'migrated')),
    "values"          jsonb       NOT NULL,              -- { channelKey: number }
    external_values   jsonb       NOT NULL,              -- { vendor register name: number }
    received_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (device_id, ts)
);
CREATE INDEX sensor_readings_tenant_device_ts ON sensor_readings (tenant_id, device_id, ts DESC);

CREATE TABLE crops (
    id            text PRIMARY KEY,
    tenant_id     text        NOT NULL,
    name          text        NOT NULL,
    variety       text        NOT NULL DEFAULT '',
    location_id   text        NOT NULL DEFAULT '',
    location_desc text        NOT NULL DEFAULT '',
    created_by    text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);
CREATE INDEX crops_tenant ON crops (tenant_id) WHERE deleted_at IS NULL;

CREATE TABLE photos (
    id                text PRIMARY KEY,
    tenant_id         text        NOT NULL,
    crop_id           text REFERENCES crops(id),
    crop_name         text        NOT NULL DEFAULT '',
    source            text        NOT NULL DEFAULT 'upload', -- upload | camera | training-pdf-ch5 ...
    device_id         text,                                  -- camera device for source = camera
    uploaded_by       text,
    captured_at       timestamptz,
    uploaded_at       timestamptz NOT NULL DEFAULT now(),
    image_path        text        NOT NULL,
    thumb_path        text,
    width             integer,
    height            integer,
    bytes             integer,
    sha256            text,
    has_issue         boolean,                               -- null = not analysed yet
    gps               jsonb,
    weather           jsonb,
    linked_sensors    jsonb       NOT NULL DEFAULT '[]',
    user_notes        text        NOT NULL DEFAULT '',
    farm_notes        text        NOT NULL DEFAULT '',
    labels            jsonb,
    ai_analysis       jsonb,
    ai_detections_raw jsonb,                                 -- raw vision-model output, kept for reference
    deleted_at        timestamptz
);
CREATE INDEX photos_tenant_crop ON photos (tenant_id, crop_id, captured_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX photos_tenant_issue ON photos (tenant_id, has_issue, captured_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX photos_sha256 ON photos (sha256);

CREATE TABLE photo_regions (
    id                 bigserial PRIMARY KEY,
    photo_id           text        NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    tenant_id          text        NOT NULL,
    seq                integer     NOT NULL DEFAULT 0,    -- order of AI detections (the frontend addresses them by index)
    client_id          text,                              -- annotation id (ann_xxx) shown to the frontend
    bbox               integer[]   NOT NULL CHECK (array_length(bbox, 1) = 4),
    crop_path          text,
    label              text        NOT NULL,
    category           text,                              -- pest | disease | weed | plant_abnormal | soil | other
    library_key        text,
    detector           text        NOT NULL,              -- qwen-vl | human | yolo
    detector_model     text,
    confidence         real,
    ai_guess           jsonb,                             -- { name, reasoning }
    note               text,
    farmer_status      text        NOT NULL DEFAULT 'pending' CHECK (farmer_status IN ('pending', 'confirmed', 'rejected')),
    farmer_by          text,
    farmer_at          timestamptz,
    expert_status      text        NOT NULL DEFAULT 'pending' CHECK (expert_status IN ('pending', 'confirmed', 'rejected')),
    expert_by          text,
    expert_at          timestamptz,
    expert_library_key text,
    embed_attempts     integer     NOT NULL DEFAULT 0,
    embed_error        text,
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX photo_regions_photo ON photo_regions (photo_id, seq);
CREATE INDEX photo_regions_confirmed_key ON photo_regions (COALESCE(expert_library_key, library_key))
    WHERE farmer_status = 'confirmed' OR expert_status = 'confirmed';

CREATE TABLE region_embeddings (
    region_id  bigint      NOT NULL REFERENCES photo_regions(id) ON DELETE CASCADE,
    model      text        NOT NULL,
    tenant_id  text        NOT NULL,
    embedding  vector(1024) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (region_id, model)
);
CREATE INDEX region_embeddings_hnsw ON region_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE pest_library (
    id         text PRIMARY KEY,
    type       text        NOT NULL CHECK (type IN ('pest', 'disease', 'weed')),
    key        text        NOT NULL,
    name       text        NOT NULL,
    aliases    text[]      NOT NULL DEFAULT '{}',
    symptoms   text        NOT NULL DEFAULT '',
    control    text        NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text,
    UNIQUE (type, key)
);

-- ---------------------------------------------------------------- phase 2 (not used yet)

CREATE TABLE tenants (
    id          text PRIMARY KEY,
    name        text        NOT NULL,
    status      text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    disabled_at timestamptz
);

CREATE TABLE users (
    id            text PRIMARY KEY,
    tenant_id     text        NOT NULL REFERENCES tenants(id),
    account       text        NOT NULL UNIQUE,
    name          text        NOT NULL DEFAULT '',
    password_hash text        NOT NULL,
    farm_role     text        NOT NULL DEFAULT 'owner' CHECK (farm_role IN ('owner', 'worker')),
    platform_role text CHECK (platform_role IN ('admin', 'expert')),
    status        text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    agent_debug   boolean     NOT NULL DEFAULT false,
    last_login_at timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE locations (
    id         text PRIMARY KEY,
    tenant_id  text        NOT NULL REFERENCES tenants(id),
    name       text        NOT NULL,
    lat        double precision,
    lng        double precision,
    area       double precision,
    metadata   jsonb       NOT NULL DEFAULT '{}',
    is_demo    boolean     NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE devices (
    id           text PRIMARY KEY,
    tenant_id    text        NOT NULL REFERENCES tenants(id),
    location_id  text REFERENCES locations(id),
    name         text        NOT NULL,
    type         text        NOT NULL,                  -- sensor_soil_api | camera | actuator ...
    provider     text,
    external_id  text,
    api_config   jsonb,                                 -- vendor credentials: never returned by the API
    online       boolean     NOT NULL DEFAULT false,
    last_seen_at timestamptz,
    metadata     jsonb       NOT NULL DEFAULT '{}',
    created_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz
);

CREATE TABLE channels (
    id            text PRIMARY KEY,
    device_id     text        NOT NULL REFERENCES devices(id),
    key           text        NOT NULL,
    external_name text        NOT NULL,
    display_name  text        NOT NULL,
    category      text,
    unit          text        NOT NULL DEFAULT '',
    precision     integer     NOT NULL DEFAULT 1,
    enabled       boolean     NOT NULL DEFAULT true,
    UNIQUE (device_id, external_name)
);

CREATE TABLE farm_tasks (
    id              text PRIMARY KEY,
    tenant_id       text        NOT NULL REFERENCES tenants(id),
    title           text        NOT NULL,
    category        text        NOT NULL DEFAULT '',
    type            text        NOT NULL DEFAULT 'user' CHECK (type IN ('user', 'ai')),
    date            date        NOT NULL,
    status          text        NOT NULL DEFAULT 'pending',
    completed_at    timestamptz,
    completed_by    text,
    ai_reason       text,
    source_photo_id text REFERENCES photos(id),
    created_by      text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX farm_tasks_tenant_date ON farm_tasks (tenant_id, date);

CREATE TABLE audit_log (
    id          bigserial PRIMARY KEY,
    tenant_id   text,
    user_id     text,
    action      text        NOT NULL,
    target_type text,
    target_id   text,
    detail      jsonb,
    ip          text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_time ON audit_log (tenant_id, created_at DESC);
