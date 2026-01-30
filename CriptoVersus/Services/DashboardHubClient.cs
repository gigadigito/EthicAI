using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Logging;
using System.Net.Http;
using System.Text.Json;

namespace CriptoVersus.Web.Services
{
    public sealed class DashboardHubClient : IAsyncDisposable
    {
        private readonly ILogger<DashboardHubClient> _logger;

        private readonly Guid _id = Guid.NewGuid();
        public Guid InstanceId => _id;

        private readonly SemaphoreSlim _startLock = new(1, 1);

        private HubConnection? _hub;

        // garante que não vamos "armar" handlers várias vezes
        private int _wired;

        // loop de reconexão: evita múltiplos loops simultâneos
        private readonly SemaphoreSlim _reconnectLock = new(1, 1);
        private CancellationTokenSource _lifetimeCts = new();
        private Task? _reconnectTask;

        public event Action<string?>? DashboardChanged;

        public HubConnectionState State => _hub?.State ?? HubConnectionState.Disconnected;
        public string? ConnectionId => _hub?.ConnectionId;

        private const string HubUrl = "https://criptoversus-api.duckdns.org/hubs/dashboard";

        public DashboardHubClient(ILogger<DashboardHubClient> logger)
        {
            _logger = logger;
            _logger.LogInformation("DashboardHubClient CREATED id={id}", _id);
        }

        public async Task EnsureStartedAsync(CancellationToken ct = default)
        {
            if (_lifetimeCts.IsCancellationRequested)
                return;

            using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, _lifetimeCts.Token);

            await _startLock.WaitAsync(linked.Token);
            try
            {
                if (_hub is not null && _hub.State == HubConnectionState.Connected)
                {
                    _logger.LogDebug("EnsureStartedAsync already connected id={id} connId={connId}", _id, _hub.ConnectionId);
                    return;
                }

                // (re)cria a conexão se não existir
                if (_hub is null)
                {
                    _hub = BuildConnection();
                    WireHandlersOnce(_hub);
                }

                // se estiver "Connecting/Reconnecting" deixa seguir
                if (_hub.State == HubConnectionState.Connected)
                    return;

                _logger.LogInformation("Starting hub... id={id} url={url}", _id, HubUrl);
                await _hub.StartAsync(linked.Token);
                _logger.LogInformation("Hub started OK id={id} connId={connId} state={state}", _id, _hub.ConnectionId, _hub.State);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "EnsureStartedAsync failed id={id}", _id);
                // não joga fora a conexão aqui; deixamos o loop/Closed cuidar
                throw;
            }
            finally
            {
                _startLock.Release();
            }
        }

        private HubConnection BuildConnection()
        {
            var handler = new HttpClientHandler
            {
                UseProxy = false,
                Proxy = null
            };

            var hub = new HubConnectionBuilder()
                .WithUrl(HubUrl, opt =>
                {
                    opt.HttpMessageHandlerFactory = _ => handler;

                    // ===== FORÇA WEBSOCKET (se falhar aqui, é proxy/NPM) =====
                    opt.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.WebSockets;
                    opt.SkipNegotiation = true; // obrigatório pra forçar WS direto

                    // se tiver auth header, configure aqui também
                    // opt.Headers.Add("Authorization", "Bearer ...");
                })
                .WithAutomaticReconnect(new[]
                {
            TimeSpan.Zero,
            TimeSpan.FromSeconds(2),
            TimeSpan.FromSeconds(5),
            TimeSpan.FromSeconds(10),
            TimeSpan.FromSeconds(20)
                })
                .Build();

            hub.ServerTimeout = TimeSpan.FromSeconds(60);
            hub.KeepAliveInterval = TimeSpan.FromSeconds(15);

            return hub;
        }


        private void WireHandlersOnce(HubConnection hub)
        {
            if (Interlocked.Exchange(ref _wired, 1) == 1)
                return;

            _logger.LogInformation("WIRING handlers id={id}", _id);

            // 1) assinatura mais comum (controller/notify manda string)
            hub.On<string>("dashboard_changed", payload =>
            {
                _logger.LogInformation("EVENT dashboard_changed (string) id={id} len={len} payload={payload}",
                    _id, payload?.Length ?? 0, payload);

                DashboardChanged?.Invoke(payload);
            });

            // 2) se o server mandar objeto, no .NET costuma chegar como JsonElement
            hub.On<JsonElement>("dashboard_changed", je =>
            {
                var payload = je.ToString();
                _logger.LogInformation("EVENT dashboard_changed (JsonElement) id={id} len={len} payload={payload}",
                    _id, payload?.Length ?? 0, payload);

                DashboardChanged?.Invoke(payload);
            });

           
            // 1) string (SEU controller manda string)
            hub.On<string>("dashboard_changed", payload =>
            {
                _logger.LogInformation("EVENT dashboard_changed (string) id={id} len={len} payload={payload}",
                    _id, payload?.Length ?? 0, payload);

                DashboardChanged?.Invoke(payload);
            });

            // 2) JsonElement (se algum lugar mandar objeto)
            hub.On<JsonElement>("dashboard_changed", je =>
            {
                var payload = je.ToString();
                _logger.LogInformation("EVENT dashboard_changed (JsonElement) id={id} len={len} payload={payload}",
                    _id, payload?.Length ?? 0, payload);

                DashboardChanged?.Invoke(payload);
            });

            // 3) fallback (casos aninhados / estranhos)
            hub.On("dashboard_changed", (object?[] args) =>
            {
                var payload = ExtractPayload(args);

                _logger.LogInformation("EVENT dashboard_changed (object[] fallback) id={id} argsLen={argsLen} payloadLen={len} payload={payload}",
                    _id, args?.Length ?? 0, payload?.Length ?? 0, payload);

                DashboardChanged?.Invoke(payload);
            });


            hub.Reconnecting += ex =>
            {
                _logger.LogWarning(ex, "Hub reconnecting id={id} state={state}", _id, hub.State);
                return Task.CompletedTask;
            };

            hub.Reconnected += connId =>
            {
                _logger.LogInformation("Hub reconnected id={id} connId={connId} state={state}", _id, connId, hub.State);
                return Task.CompletedTask;
            };

            hub.Closed += ex =>
            {
                _logger.LogWarning(ex, "Hub CLOSED id={id} state={state}. Will start reconnect loop.", _id, hub.State);

                // dispara loop em background, mas garantimos 1 por vez
                if (_reconnectTask is null || _reconnectTask.IsCompleted)
                {
                    _reconnectTask = Task.Run(() => ReconnectLoopAsync(_lifetimeCts.Token));
                }

                return Task.CompletedTask;
            };
        }

        private static string? ExtractPayload(object?[]? args)
        {
            if (args is null || args.Length == 0)
                return null;

            // tenta achar a primeira coisa útil
            foreach (var a in args)
            {
                if (a is null) continue;

                if (a is string s) return s;
                if (a is JsonElement je) return je.ToString();

                // pode vir aninhado (object[])
                if (a is object[] arr)
                {
                    foreach (var x in arr)
                    {
                        if (x is null) continue;
                        if (x is string s2) return s2;
                        if (x is JsonElement je2) return je2.ToString();
                    }
                }

                // fallback serialize
                try
                {
                    return JsonSerializer.Serialize(a);
                }
                catch
                {
                    return a.ToString();
                }
            }

            return null;
        }

        private async Task ReconnectLoopAsync(CancellationToken ct)
        {
            if (ct.IsCancellationRequested)
                return;

            await _reconnectLock.WaitAsync(ct);
            try
            {
                var attempt = 0;
                var delays = new[] { 2, 5, 10, 20, 30 };

                while (!ct.IsCancellationRequested)
                {
                    attempt++;

                    var delaySeconds = delays[Math.Min(attempt - 1, delays.Length - 1)];
                    try
                    {
                        _logger.LogInformation("ReconnectLoop attempt={attempt} waiting {sec}s id={id}", attempt, delaySeconds, _id);
                        await Task.Delay(TimeSpan.FromSeconds(delaySeconds), ct);
                    }
                    catch (OperationCanceledException)
                    {
                        return;
                    }

                    try
                    {
                        // garante que o hub existe
                        if (_hub is null)
                        {
                            _logger.LogInformation("ReconnectLoop: hub null -> rebuild id={id}", _id);
                            _hub = BuildConnection();
                            WireHandlersOnce(_hub);
                        }

                        if (_hub.State == HubConnectionState.Connected)
                        {
                            _logger.LogInformation("ReconnectLoop: already connected id={id} connId={connId}", _id, _hub.ConnectionId);
                            return;
                        }

                        _logger.LogInformation("ReconnectLoop: StartAsync id={id} state={state}", _id, _hub.State);
                        await EnsureStartedAsync(ct);

                        _logger.LogInformation("ReconnectLoop: success id={id} connId={connId}", _id, _hub.ConnectionId);
                        return;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "ReconnectLoop: failed attempt={attempt} id={id}", attempt, _id);

                        // se a conexão estiver quebrada, reconstrói na próxima tentativa
                        try
                        {
                            if (_hub is not null)
                            {
                                await _hub.DisposeAsync();
                            }
                        }
                        catch { /* ignore */ }
                        finally
                        {
                            _hub = null;
                            // permite re-wire na nova instância
                            Interlocked.Exchange(ref _wired, 0);
                        }
                    }
                }
            }
            finally
            {
                try { _reconnectLock.Release(); } catch { }
            }
        }

        public async ValueTask DisposeAsync()
        {
            _logger.LogInformation("DashboardHubClient DisposeAsync id={id}", _id);

            try { _lifetimeCts.Cancel(); } catch { }

            _startLock.Dispose();
            _reconnectLock.Dispose();

            if (_hub is not null)
            {
                try { await _hub.StopAsync(); } catch { }
                try { await _hub.DisposeAsync(); } catch { }
                _hub = null;
            }

            _lifetimeCts.Dispose();
        }
    }
}
