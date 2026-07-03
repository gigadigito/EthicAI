using System.Text;

namespace DTOs;

public static class TextMojibakeRepair
{
    private static readonly Lazy<Encoding> Windows1252Encoding = new(() => Encoding.GetEncoding(1252));
    private static readonly string[] SuspectMarkers =
    [
        "Ã",
        "Â",
        "Æ",
        "â€",
        "Ãƒ",
        "Ã‚",
        "Ã†",
        "Ã¢â‚¬",
        "Æ’",
        "ï¿½"
    ];

    static TextMojibakeRepair()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
    }

    public static string Normalize(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return string.Empty;

        var current = text.Trim();
        var best = current;

        for (var i = 0; i < 3; i++)
        {
            if (!LooksLikeMojibake(current))
                break;

            var repaired = RepairOnce(current);
            if (string.IsNullOrWhiteSpace(repaired) || string.Equals(repaired, current, StringComparison.Ordinal))
                break;

            best = repaired;
            current = repaired;
        }

        return best;
    }

    public static string? NormalizeOrNull(string? text)
        => string.IsNullOrWhiteSpace(text) ? null : Normalize(text);

    public static bool LooksLikeMojibake(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return false;

        return SuspectMarkers.Any(marker => text.Contains(marker, StringComparison.Ordinal));
    }

    private static string RepairOnce(string text)
    {
        try
        {
            var bytes = Windows1252Encoding.Value.GetBytes(text);
            return Encoding.UTF8.GetString(bytes);
        }
        catch
        {
            return text;
        }
    }
}


