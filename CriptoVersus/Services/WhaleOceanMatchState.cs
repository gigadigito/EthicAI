using System.Globalization;
using DTOs;

namespace CriptoVersus.Web.Services;

public static class WhaleOceanMatchState
{
    public static bool IsFinished(MatchDto? match)
    {
        if (match is null)
            return false;

        return match.IsFinished
            || match.EndTime.HasValue
            || match.Status.Equals("Completed", StringComparison.OrdinalIgnoreCase)
            || match.Status.Equals("Cancelled", StringComparison.OrdinalIgnoreCase);
    }

    public static string FormatEndDateUtc(DateTime endTimeUtc, string cultureCode)
    {
        var culture = GetCulture(cultureCode);
        var format = culture.Name switch
        {
            "en-US" => "MM/dd/yyyy",
            "zh-CN" or "ja-JP" => "yyyy/MM/dd",
            _ => "dd/MM/yyyy"
        };

        return DateTime.SpecifyKind(endTimeUtc, DateTimeKind.Utc).ToString(format, culture);
    }

    public static string FormatEndClockUtc(DateTime endTimeUtc)
        => DateTime.SpecifyKind(endTimeUtc, DateTimeKind.Utc).ToString("HH:mm:ss", CultureInfo.InvariantCulture);

    private static CultureInfo GetCulture(string cultureCode)
    {
        try
        {
            return CultureInfo.GetCultureInfo(cultureCode);
        }
        catch (CultureNotFoundException)
        {
            return CultureInfo.InvariantCulture;
        }
    }
}
