using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace CriptoVersus.Worker.MarketFlow;

public interface IMarketFlowTransport
{
    Task RunAsync(IReadOnlyCollection<string> symbols, Func<ReadOnlyMemory<byte>, CancellationToken, ValueTask> onMessage, int maxMessageBytes, CancellationToken cancellationToken);
}

public sealed class BinanceMarketFlowTransport : IMarketFlowTransport
{
    private static readonly Uri Endpoint = new("wss://stream.binance.com:9443/stream");

    public async Task RunAsync(IReadOnlyCollection<string> symbols, Func<ReadOnlyMemory<byte>, CancellationToken, ValueTask> onMessage, int maxMessageBytes, CancellationToken cancellationToken)
    {
        using var socket = new ClientWebSocket();
        // ClientWebSocket handles server ping/pong frames. Do not emit extra control messages into Binance's limit.
        socket.Options.KeepAliveInterval = Timeout.InfiniteTimeSpan;
        await socket.ConnectAsync(Endpoint, cancellationToken);
        var request = JsonSerializer.SerializeToUtf8Bytes(new { method = "SUBSCRIBE", @params = symbols.Select(s => s.ToLowerInvariant() + "@aggTrade").ToArray(), id = Guid.NewGuid().ToString("N") });
        await socket.SendAsync(request, WebSocketMessageType.Text, true, cancellationToken);

        var receiveBuffer = new byte[8 * 1024];
        using var message = new MemoryStream();
        try
        {
            while (!cancellationToken.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                var result = await socket.ReceiveAsync(receiveBuffer, cancellationToken);
                if (result.MessageType == WebSocketMessageType.Close) return;
                if (result.MessageType != WebSocketMessageType.Text) continue;
                if (message.Length + result.Count > maxMessageBytes)
                    throw new InvalidDataException("Binance market-flow message exceeded configured size limit.");
                message.Write(receiveBuffer, 0, result.Count);
                if (!result.EndOfMessage) continue;
                await onMessage(message.ToArray(), cancellationToken);
                message.SetLength(0);
            }
        }
        finally
        {
            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                try { await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "shutdown", CancellationToken.None); }
                catch (WebSocketException) { }
            }
        }
    }
}
