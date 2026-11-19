# Match DEV Sandbox

`/dev/match-preview` is an offline visual sandbox for the real `MatchDetail`
component and its existing TV price, Candle Battle, percentage, volume, event
feed and Arena Pressure visualizations.

## Enable and run

The route is Development-only and controlled by an explicit flag. The checked-in
Development configuration enables it; to disable it locally, set:

```json
"MatchPreview": {
  "Enabled": true,
  "Seed": 20261118
}
```

Then start only the Web project and open `http://localhost:<web-port>/dev/match-preview`.
The Web project still needs an `Api:BaseUrl` configuration value to build its
normal HTTP client, but the preview does not use that client; the API, Worker
and database can remain stopped.

## Controls

The panel controls play/pause, restart, a single event step, speeds 1x/2x/5x/10x,
the seed, and reproducible market profiles: up, down, sideways, high/low
volatility, high volume, balanced and comeback. It also exposes waiting,
active, completed, loading, simulated failure, no-data and partial-data states.

The seed is session-local. `Reset same seed` returns the selected scenario to
the same deterministic series, which makes visual regressions reproducible.
To add a scenario, extend `MatchPreviewDataSource.Profile` and add its option
to `MatchPreviewDevPanel`.

## Isolation

`MatchPreviewDataSource` is scoped to the preview circuit and emits the DTO
shapes consumed by `MatchDetail`. The production route does not receive that
parameter and continues to use `CriptoVersusApiClient` plus `DashboardHubClient`.
Preview mode neither starts the dashboard hub nor renders investment, alert or
community-match actions. It uses local data-URI coin marks rather than the icon
API. Its generator holds all match, metric, event and sentiment values in
memory and never persists them.

`Program.cs` returns 404 for the path outside Development. Inside Development,
the page displays an enablement notice until the explicit configuration flag is
set. A visible `DEV · SIMULATED DATA` label remains above the preview at all
times.
