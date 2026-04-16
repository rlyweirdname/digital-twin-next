## Smart Room Digital Twin (Next.js)

This app is a full Next.js reset of the dashboard.

- Frontend route: `/`
- API routes: `/api/state`, `/api/logs`, `/api/logs/stats`
- Data persistence: `data/digital_twin.json`

## Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## API

`GET /api/state`
- Returns current digital twin state.

`PUT /api/state`
- Updates state payload:
```json
{
  "current_temp": 28,
  "target_temp": 28,
  "humidity": 55,
  "fan_on": false,
  "ac_on": false,
  "mode": "auto"
}
```

`POST /api/logs`
- Creates a log entry payload:
```json
{
  "temperature": 29.4,
  "humidity": 57,
  "fan_on": true,
  "ac_on": false,
  "target_temp": 28,
  "mode": "auto"
}
```

`GET /api/logs?limit=100&offset=0`
- Returns log entries (latest first). Optional `start_time` and `end_time` filters are supported.

`DELETE /api/logs`
- Clears all logs.

`GET /api/logs/stats?hours=24`
- Returns aggregate stats for the selected hour window.

## Verify

```bash
npm run lint
npm run build
```
