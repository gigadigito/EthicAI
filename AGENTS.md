# CriptoVersus Agent Guide

## Scope

These instructions apply to the entire repository. They are written for OpenCode and other coding agents working on CriptoVersus.

Read `ARCHITECTURE.md` before making cross-project changes. Treat project manifests and executable code as the source of truth. If an architectural change makes the document inaccurate, update `ARCHITECTURE.md` in the same task.

## Repository Map

- `CriptoVersus`: current Blazor Interactive Server frontend.
- `CriptoVersus.API`: REST API, JWT authentication, SignalR, and external service integrations.
- `CriptoVersus.Worker`: market cycle, match lifecycle, scoring, settlement, heartbeat, and retention.
- `CriptoVersus.Mcp`: Node.js/TypeScript read-only MCP server.
- `Businnes`: BLL project. Preserve the physical path despite the spelling unless an explicit repository-wide rename is requested.
- `DAL`: EF Core/PostgreSQL context, entities, migrations, and schema helpers.
- `DTOs`: shared contracts and transport utilities.
- `EthicAI`: legacy Web application, not the current CriptoVersus frontend.
- `solana`: ancillary Anchor/Rust program outside the .NET solution.
- `docs`: operational documentation and SQL.

Do not assume that every root folder is active source. Backup, temporary, build, browser-profile, and diagnostic folders exist in this workspace.

## Safety and Secrets

- Never read, print, copy, summarize, or commit secrets.
- Do not inspect `.env`, `secrets.json`, private key files, keypairs, or production appsettings unless the user explicitly authorizes a narrowly scoped operation.
- Do not expose connection strings, tokens, wallet secrets, API keys, or production identifiers in logs, tests, documentation, patches, or responses.
- Use configuration keys and environment-variable names in documentation, never real values.
- Treat files with names suggesting keypairs or credentials as sensitive even when they are under build or temporary directories.
- Preserve environment-isolation guards. Do not weaken production-versus-development checks to make local tests pass.

## Active Architecture

The expected runtime direction is:

```text
Browser -> CriptoVersus.Web -> CriptoVersus.API
CriptoVersus.API -> BLL / DAL / DTOs -> PostgreSQL
CriptoVersus.Worker -> BLL / DAL / DTOs -> PostgreSQL
CriptoVersus.Worker -> CriptoVersus.API for notification and audio
CriptoVersus.Mcp -> CriptoVersus.API for public read-only data
```

Important details:

- CriptoVersus.Web is Blazor Server, not a WebAssembly SPA.
- Most C# API calls from Razor components execute in the Web server process.
- `DashboardHubClient` connects from the Web server to the API SignalR hub.
- API and Worker currently share PostgreSQL directly.
- The API does not call the Worker to execute work.
- The API reads Worker status from PostgreSQL.
- MCP has no direct DAL or PostgreSQL access.
- EthicAI is legacy. Do not implement new CriptoVersus features there unless explicitly requested.

## General Engineering Rules

- Prefer the smallest correct change.
- Follow existing namespaces, nullable annotations, and implicit-using conventions.
- Keep async paths asynchronous and pass `CancellationToken` through I/O boundaries.
- Use dependency injection for services and external clients.
- Avoid adding static mutable state.
- Do not add compatibility fallbacks without a demonstrated requirement.
- Do not duplicate endpoint paths, event names, scoring rules, or normalization logic when a shared owner already exists.
- Preserve financial precision. Use `decimal` for balances, stakes, fees, payouts, and position capital.
- Make financial and scoring operations idempotent before adding retries.
- Preserve auditability of ledger, payout, score event, and lifecycle records.
- Add comments only for non-obvious constraints or algorithms.

## Project Boundaries

### Web

- New Web data access should go through API clients, not DAL or `EthicAIDbContext`.
- Prefer focused API-client methods over raw `HttpClient` calls inside Razor components.
- Do not add new Web dependencies on DAL.
- Keep browser-only behavior in JavaScript interop modules.
- Remember that component C# runs on the server under Interactive Server render mode.
- Dispose SignalR subscriptions, timers, cancellation sources, and JS modules in component lifecycle cleanup.
- Preserve localized routes and SEO behavior when changing public pages.
- Update all supported cultures when adding user-visible localization keys.
- Do not render internal API hostnames into browser-visible URLs.

### API

- Keep authentication and authorization explicit. The fallback policy requires authenticated users unless `[AllowAnonymous]` is intentional.
- Controllers should validate transport concerns and delegate business rules to services.
- Prefer DTOs at HTTP boundaries; do not expose EF entities directly.
- Use typed or named `HttpClient` instances for external services.
- Preserve forwarded-header behavior for reverse-proxy deployments.
- Treat Worker-facing endpoints as service-to-service contracts.
- When changing routes consumed by Web, MCP, Worker, n8n, or integration tests, update all consumers and architecture documentation.
- Do not introduce new production-only behavior without a health check or failure strategy.

### Worker

- Preserve stage ordering unless the task explicitly changes lifecycle semantics.
- A stage must be safe under retry, partial failure, and process restart.
- Update Worker heartbeat/status around long-running work.
- Do not silently skip settlement, score-event persistence, or position synchronization.
- Keep score-event deduplication intact.
- Use transactions for related financial and lifecycle writes.
- Avoid new runtime DDL. Prefer versioned DAL migrations.
- External market failures should degrade safely and must not corrupt match state.
- Do not infer that an empty external snapshot means all matches are invalid without the existing confirmation rules.
- Keep retention work separate from the primary cycle and preserve dry-run support.

### BLL

- Put authoritative match, scoring, position, and fund rules in BLL rather than Web components or controllers.
- Keep pure calculations independent from EF Core where practical.
- Avoid new interfaces that accept `EthicAIDbContext` unless the existing transaction model requires it.
- Do not duplicate Worker orchestration logic inside BLL.
- Treat full-on-chain operations as incomplete until all methods and tests exist. Do not silently fall back to a different financial mode.

### DAL

- Use EF Core migrations for durable schema changes.
- Keep PostgreSQL naming, indexes, precision, delete behavior, and UTC semantics consistent with existing mappings.
- Do not place API response DTO logic in DAL.
- Review concurrency and uniqueness constraints for financial, scoring, and community-match changes.
- Do not edit or remove production data through ad hoc scripts as part of a code task.
- When adding migration-time or startup schema logic, document which process owns execution.

### DTOs

- Keep DTOs free of DAL, ASP.NET controller, and infrastructure dependencies.
- Preserve JSON compatibility for public contracts unless a breaking change is explicitly approved.
- Put request/response shape changes in DTOs when multiple projects consume them.
- Avoid stubs or duplicate DTO definitions in tests when the real DTO project can be referenced.

### MCP

- Keep MCP tools read-only unless the product explicitly approves a broader security model.
- Verify that every tool route exists in the current API before declaring the tool functional.
- Do not add direct PostgreSQL, DAL, ledger, custody, or private-key access.
- Validate upstream API responses instead of trusting manually defined shapes.
- Preserve local signature verification and hashed token storage.
- Enforce limits that are exposed as product behavior; do not only persist them.
- Run TypeScript build/type checking after MCP changes.

## Futurebol

Primary locations:

- Blazor host: `CriptoVersus/Components/Pages/Futurebol`.
- TypeScript source: `CriptoVersus/wwwroot/js/futurebol`.
- Generated JavaScript: `CriptoVersus/wwwroot/js/dist/futurebol`.
- Assets: `CriptoVersus/wwwroot/assets/futurebol`.

Rules:

- Treat TypeScript source as authoritative; do not hand-edit generated `dist` files.
- Rebuild TypeScript after source changes.
- Preserve the Babylon loader lifecycle and cleanup behavior.
- Keep mock-market execution deterministic so tests remain stable.
- Keep API-fed market state separate from simulation state.
- Maintain primitive-player fallback when GLB loading or WebGL capabilities fail.
- Do not remove loading, error-reporting, quality, or disposal paths.
- Optimize assets deliberately; do not replace models or vendor runtimes without checking load time and licensing.
- Add or update tests for match state, market source, animation, and player assets when behavior changes.

## Candle Battle

There are two distinct concerns:

- Authoritative scoring: `BLL.NFTFutebol.CandleBattleScoringService`, executed by Worker.
- Presentation: `CriptoVersus/Components/Shared/TvCandleBattle.razor`.

Rules:

- Never make the Web visualization authoritative for persisted score.
- Preserve snapshot pairing, bootstrap behavior, state keys, and event deduplication in scoring changes.
- Keep persisted `MatchScoreState` and `MatchScoreEvent` changes transactional and retry-safe.
- When changing visual candle calculations, explicitly determine whether authoritative scoring should also change.
- The `tvCandleBattle*.mjs` files are not verified as the active rendering path. Confirm imports before modifying or deleting them.
- Update Worker tests and Web/TV tests for cross-layer Candle Battle changes.

## SignalR

- The API hub route is `/hubs/dashboard`.
- The active event is `dashboard_changed`.
- The active client is the server-side `DashboardHubClient`.
- Keep connection, reconnection, event subscription, and disposal behavior intact.
- Do not assume static connection counters work across API replicas.
- If adding multiple event types, use shared constants or typed payload contracts.
- Review authentication before adding data-bearing hub methods or events.

## PostgreSQL and Migrations

- API, Worker, BLL, and legacy EthicAI currently share `EthicAIDbContext`.
- API and Worker both apply migrations on startup; EthicAI does so as well.
- Schema changes can affect all running processes and must be backward-compatible across rolling deployments or deployed in a coordinated window.
- Prefer expand-and-contract migrations for incompatible changes.
- Do not enable sensitive EF logging outside Development.
- Avoid introducing table/view creation directly in Worker code.
- PostgreSQL `LISTEN/NOTIFY` feeds dashboard invalidation; preserve notification compatibility when changing related triggers or payloads.

## Frontend and TypeScript

- Install frontend dependencies from `CriptoVersus/package-lock.json` with `npm ci`.
- Compile TypeScript with `npm run ts:build`.
- Use `npm run ts:watch` only for local development.
- Keep source under `wwwroot/js`; treat `wwwroot/js/dist` as generated output.
- Do not add a new chart, audio, wallet, or localization implementation before checking for an existing module.
- Preserve mobile, tablet, and desktop TV layouts.
- Babylon.js is the Futurebol 3D runtime. Do not introduce a second 3D engine without an explicit migration plan.
- Solana wallet code runs in the browser. Never move private-key handling into repository code.

## Tests and Verification

Use the narrowest relevant commands first.

```powershell
dotnet test "EthicAI.test/EthicAI.test.csproj"
dotnet test "CriptoVersus.API.Tests/CriptoVersus.API.Tests.csproj"
dotnet test "CriptoVersus.Worker.Tests/CriptoVersus.Worker.Tests.csproj"
npm run test:futurebol --prefix "CriptoVersus"
npm run test:tv-charts --prefix "CriptoVersus"
npm run build --prefix "CriptoVersus.Mcp"
```

Integration tests are opt-in:

```powershell
dotnet test "CriptoVersus.Tests.Integration/CriptoVersus.Tests.Integration.csproj"
```

Do not enable production integration tests or point tests at production without explicit user approval.

For cross-project .NET changes, also validate:

```powershell
dotnet build "EthicAI.sln"
```

Be aware that `CriptoVersus.API.Tests` is not currently included in the solution and requires its own test command.

## Docker and Deployment

- Root `Dockerfile` builds the API.
- `CriptoVersus.Mcp/Dockerfile` and `docker-compose.yml` build the MCP service.
- `EthicAI/Dockerfile` is legacy.
- Web and Worker production compose files are external to this repository.
- Do not claim a full local compose environment exists in this repository.
- Preserve container-internal API URLs separately from browser-visible public URLs.
- Do not edit deployment commands, network names, or production settings without confirming the external stack topology.

## Legacy, Backup, and Generated Files

Do not use these as primary implementation sources without explicit confirmation:

- `EthicAI/EthicAI - Backup.csproj`.
- `backup-audio-admin-*`.
- `FuturebolArquivosBackup_*`.
- `FuturebolPacotesExtraidosErrado`.
- root `tmp`, `tempbuild`, `.tmp*`, `.codex-*`, `_build*`, and `_codex_tmp` outputs.
- root build logs and `tmp_*` diagnostics.

Do not delete them unless the user explicitly requests cleanup. Never copy code from backups over active files without comparing behavior and tests.

## Documentation Expectations

- Update `ARCHITECTURE.md` for new project references, service boundaries, protocols, Worker stages, database ownership, Futurebol architecture, Candle Battle ownership, or deployment topology.
- Document why a new cross-project dependency is necessary.
- Keep examples free of real credentials and production values.
- Prefer paths and class names that can be verified directly in the repository.

## Definition of Done

A code change is complete when applicable items are satisfied:

- The smallest relevant tests pass.
- Cross-project build dependencies are explicit.
- Public and service-to-service contracts remain compatible or are intentionally versioned.
- Financial and scoring behavior remains idempotent and auditable.
- Blazor resources, SignalR handlers, timers, and JS modules are disposed.
- TypeScript generated output is rebuilt according to repository policy.
- No secret, production configuration, or unrelated workspace change is included.
- `ARCHITECTURE.md` is updated when the architecture changed.
