# Current Project Status

Last updated: 2026-04-19

## Current Runtime

The project currently runs as a Node.js app through:

```text
server.js
```

The frontend is served by the same backend from static files:

```text
index.html
app.js
style.css
logo.jpg
```

Runtime state is stored in:

```text
server-data/app-state.json
```

## Default Admin

```text
account: admin
password: admin123456
role: platform_admin
```

The admin password can be overridden before first startup with:

```text
ADMIN_PASSWORD
```

## Completed Work

### Backend

1. Added login and token-based auth.
2. Added default admin account initialization.
3. Added account management APIs.
4. Added backend device API integration for 0531yun cloud devices.
5. Added cloud polling collector with duplicate prevention.
6. Added manual cloud history supplement sync.
7. Added local JSON persistence under `server-data/app-state.json`.
8. Added `recordTimeStr` preservation so history display can use device/cloud time instead of local system time.

### Frontend

1. Added web login page.
2. Added account management page for admin users.
3. Preserved existing display modes.
4. Cloud devices are imported only after the user enters account/identification information.
5. Cloud device local ID now equals cloud `deviceAddr`.
6. Device ID / Modbus address field is locked in add and edit modals.
7. Realtime page shows latest stored data and recent real readings.
8. History records page supports dynamic parameter filters.
9. History records display range is separate from cloud supplement range.
10. Cloud supplement data persists to backend storage and skips duplicates.
11. Charts show one chart per sensor parameter.
12. Chart page refreshes automatically when the selected device or range changes.
13. Manual chart query button was removed.

## Important Current Rules

### Device Timestamp

Use device/cloud time as the authoritative timestamp.

Preferred display order:

```text
recordTimeStr -> deviceTimestamp -> receivedAt only for debugging
```

History table "reported time" should display `recordTimeStr` if available.

### Cloud Supplement Range

Cloud supplement has its own range selector:

```text
cs-sync-range-preset
```

This range controls cloud history import only.

### History Display Range

History table display uses:

```text
cloud-hist-range-preset
```

This affects only local display filtering.

### Dynamic Parameter Filter

History parameter filter is dynamic per device.

Rules:

```text
No checkbox selected -> show all parameters.
One or more selected -> show time plus selected parameters.
```

### Duplicate Prevention

The backend skips duplicate readings by signature:

```text
deviceId + deviceTimestamp + normalized values
```

## Current Known Deployment Setup

Recommended server setup:

```text
Nginx port 80 -> Node server.js port 3000
PM2 keeps Node running
```

Common commands:

```bash
pm2 restart agri-monitor
pm2 logs agri-monitor --lines 50
curl http://127.0.0.1:3000/api/v1/health
```

## Recent UI Details

The history records page has two top-level areas:

1. Cloud supplement toolbar:
   - Target device
   - Supplement range
   - Supplement cloud data button

2. Local history display panel:
   - Display range
   - Dynamic parameter filter
   - Export report button
   - Stored history table

The filter layout has dedicated CSS classes:

```text
cloud-hist-config-row
cloud-hist-field
cloud-hist-factor-box
```

## Files That Matter Most

```text
server.js          Backend, auth, cloud API, storage, history sync
app.js             Frontend app logic
index.html         Page structure and modals
style.css          UI styling
server-data/       Runtime local database
ARCHITECTURE.md    Architecture and data model
DEPLOYMENT.md      Server deployment guide
CURRENT_STATUS.md  Current implementation status
```

## Notes For Future Work

1. Do not bring back 30-second cloud polling.
2. Do not store cloud supplement history only in frontend memory.
3. Do not use random IDs for imported cloud devices.
4. Keep web and future mini program clients using backend APIs.
5. Keep raw payloads and normalized readings for future AI analysis.
6. If moving to SQL later, preserve API contracts first, then migrate storage behind the backend.
