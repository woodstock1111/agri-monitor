# Agri Monitor Server Plan

## Current Frontend Modes

- `local`: all data is stored in browser localStorage
- `hybrid`: UI remains local-first, but backend health and cloud proxy are enabled
- `remote`: reserved for full backend mode

You can switch modes from the browser console:

```js
agriRuntime.setMode('local')
agriRuntime.setMode('hybrid', { backendBaseUrl: 'http://localhost:8080/api/v1' })
agriRuntime.setMode('remote', { backendBaseUrl: 'https://your-domain/api/v1' })
```

## Suggested API Resources

- `GET /api/v1/health`
- `GET /api/v1/locations`
- `POST /api/v1/locations`
- `PUT /api/v1/locations/:id`
- `DELETE /api/v1/locations/:id`
- `GET /api/v1/devices`
- `POST /api/v1/devices`
- `PUT /api/v1/devices/:id`
- `DELETE /api/v1/devices/:id`
- `GET /api/v1/readings?deviceId=:id&range=24h`
- `POST /api/v1/readings/batch`
- `GET /api/v1/automations`
- `POST /api/v1/automations`
- `PUT /api/v1/automations/:id`
- `DELETE /api/v1/automations/:id`
- `GET /api/v1/automation-logs`

## Suggested Tables

### `locations`

- `id`
- `name`
- `type`
- `lat`
- `lng`
- `area`
- `notes`
- `created_at`
- `updated_at`

### `devices`

- `id`
- `name`
- `type`
- `location_id`
- `address`
- `protocol`
- `stream_url`
- `notes`
- `online`
- `lat`
- `lng`
- `metadata_json`
- `created_at`
- `updated_at`

### `device_readings`

- `id`
- `device_id`
- `recorded_at`
- `source`
- `payload_json`

### `automations`

- `id`
- `name`
- `description`
- `enabled`
- `conditions_json`
- `actions_json`
- `created_at`
- `updated_at`

### `automation_logs`

- `id`
- `automation_id`
- `executed_at`
- `condition_text`
- `action_text`
- `result_text`

## Migration Priority

1. Replace `DataRepository` read methods with backend fetches.
2. Replace save/delete methods with REST calls.
3. Move `HistoryStore` to `device_readings`.
4. Move automation execution from browser timer to server worker.
5. Keep cloud proxy as a separate integration service.
