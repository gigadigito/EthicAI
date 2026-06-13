namespace CriptoVersus.Web.Services;

public static class MarketAccentPalette
{
    public static string Resolve(string? symbol)
    {
        var normalized = symbol?.Trim().ToUpperInvariant() ?? string.Empty;

        return normalized switch
        {
            "BTC" => "#f5b942",
            "ETH" => "#7f8df6",
            "SOL" => "#55f5bf",
            "BNB" => "#f2d56b",
            "XRP" => "#71d1ff",
            "ADA" => "#5dd8ff",
            "DOGE" => "#efc166",
            _ => HashAccent(normalized)
        };
    }

    private static string HashAccent(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return "#53c8ff";

        var seed = value.Sum(ch => ch);
        var hue = seed % 360;
        return $"hsl({hue} 78% 64%)";
    }
}
