using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using DTOs;

namespace BLL.NFTFutebol;

// Shared public kline transport for arcade candles and Worker volume windows.
public sealed class BinanceKlineClient(HttpClient client)
{
    public async Task<long> GetServerTimeAsync(CancellationToken ct)
    {
        using var response = await client.GetAsync("https://api.binance.com/api/v3/time", ct);
        response.EnsureSuccessStatusCode();
        using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        return json.RootElement.GetProperty("serverTime").GetInt64();
    }

    public async Task<IReadOnlyList<CandleBattlesCandleDto>> GetAsync(
        string symbol, int minutes, long startMs, long endMs, int limit, long serverTime, CancellationToken ct)
    {
        var rows = await GetRowsAsync(symbol, minutes, startMs, endMs, limit, ct);
        return Parse(rows, symbol, minutes, serverTime);
    }

    public async Task<decimal?> GetQuoteVolumeAsync(string symbol, int minutes, long startMs, long endMs, CancellationToken ct)
    {
        var rows = await GetRowsAsync(symbol, minutes, startMs, endMs, 1, ct);
        if (rows is null || rows.Count == 0 || rows[0].Count < 8) return null;
        return TryDecimal(rows[0][7], out var value) ? value : 0m;
    }

    private async Task<List<List<JsonElement>>?> GetRowsAsync(string symbol, int minutes, long startMs, long endMs, int limit, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(symbol) || symbol.Length > 64 || symbol.Any(char.IsControl))
            throw new ArgumentException("Invalid market symbol", nameof(symbol));
        var url = $"https://api.binance.com/api/v3/klines?symbol={Uri.EscapeDataString(symbol)}&interval={minutes}m&startTime={startMs}&endTime={endMs}&limit={Math.Clamp(limit, 1, 1000)}";
        using var response = await client.GetAsync(url, ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<List<List<JsonElement>>>(cancellationToken: ct);
    }

    public static IReadOnlyList<CandleBattlesCandleDto> Parse(List<List<JsonElement>>? rows, string symbol, int minutes, long serverTime)
    {
        var result = new List<CandleBattlesCandleDto>();
        foreach (var row in rows ?? [])
        {
            if (row.Count < 8 || !row[0].TryGetInt64(out var openTime) || !row[6].TryGetInt64(out var lastMs)) continue;
            var period = minutes * 60_000L;
            if (openTime % period != 0 || lastMs != openTime + period - 1 || openTime > serverTime) continue;
            if (!TryDecimal(row[1], out var open) || !TryDecimal(row[2], out var high) || !TryDecimal(row[3], out var low)
                || !TryDecimal(row[4], out var close) || !TryDecimal(row[7], out var volume)) continue;
            if (open <= 0 || low <= 0 || low > Math.Min(open, close) || high < Math.Max(open, close) || volume < 0) continue;
            result.Add(new(symbol, openTime, openTime + period, serverTime, open, high, low, close, volume,
                serverTime >= openTime + period + 1500));
        }
        return result.OrderBy(x => x.OpenTime).DistinctBy(x => x.OpenTime).ToArray();
    }
    private static bool TryDecimal(JsonElement value, out decimal number)
        => decimal.TryParse(value.ValueKind == JsonValueKind.String ? value.GetString() : value.GetRawText(),
            NumberStyles.Float, CultureInfo.InvariantCulture, out number);
}
