using System.Globalization;
using System.Text.Json;

namespace CriptoVersus.Worker.MarketFlow;

public static class BinanceAggregateTradeParser
{
    public static bool TryParse(ReadOnlySpan<byte> payload, out BinanceAggregateTrade? trade)
    {
        trade = null;
        try
        {
            using var document = JsonDocument.Parse(payload.ToArray());
            var root = document.RootElement;
            if (root.TryGetProperty("data", out var wrapped)) root = wrapped;
            if (!root.TryGetProperty("e", out var eventType) || eventType.GetString() != "aggTrade") return false;

            if (!TryString(root, "s", out var symbol) || !IsSymbol(symbol)
                || !TryInt64(root, "a", out var id) || id < 0
                || !TryDecimal(root, "p", out var price) || price <= 0
                || !TryDecimal(root, "q", out var quantity) || quantity <= 0
                || !TryInt64(root, "T", out var timestamp) || timestamp <= 0
                || !root.TryGetProperty("m", out var maker) || (maker.ValueKind is not JsonValueKind.True and not JsonValueKind.False))
                return false;

            DateTimeOffset time;
            try { time = DateTimeOffset.FromUnixTimeMilliseconds(timestamp); }
            catch (ArgumentOutOfRangeException) { return false; }

            trade = new BinanceAggregateTrade(symbol.ToUpperInvariant(), id, price, quantity, time, maker.GetBoolean());
            return true;
        }
        catch (JsonException) { return false; }
    }

    private static bool TryString(JsonElement element, string property, out string value)
    {
        value = string.Empty;
        if (!element.TryGetProperty(property, out var propertyValue) || propertyValue.ValueKind != JsonValueKind.String)
            return false;
        value = propertyValue.GetString() ?? string.Empty;
        return !string.IsNullOrWhiteSpace(value);
    }

    private static bool TryInt64(JsonElement element, string property, out long value)
    {
        value = 0;
        return element.TryGetProperty(property, out var valueElement) && valueElement.TryGetInt64(out value);
    }

    private static bool TryDecimal(JsonElement element, string property, out decimal value)
    {
        value = 0;
        if (!element.TryGetProperty(property, out var valueElement)) return false;
        var raw = valueElement.ValueKind == JsonValueKind.String ? valueElement.GetString() : valueElement.GetRawText();
        return decimal.TryParse(raw, NumberStyles.Number, CultureInfo.InvariantCulture, out value);
    }

    private static bool IsSymbol(string symbol)
        => symbol.Length is > 0 and <= 32 && symbol.All(char.IsLetterOrDigit);
}
