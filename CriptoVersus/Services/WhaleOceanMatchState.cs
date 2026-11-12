using System.Globalization;
using DTOs;

namespace CriptoVersus.Web.Services;

public static class WhaleOceanMatchState
{
    public enum OfficialStatus
    {
        Unavailable,
        Live,
        Finalized
    }

    public static bool IsFinished(MatchDto? match)
    {
        if (match is null)
            return false;

        return match.IsFinished
            || match.EndTime.HasValue
            || IsFinalStatus(match.Status);
    }

    public static OfficialStatus NormalizeStatus(MatchDto? match)
    {
        if (match is null)
            return OfficialStatus.Unavailable;

        return IsFinished(match)
            ? OfficialStatus.Finalized
            : OfficialStatus.Live;
    }

    public static string NormalizeRawStatus(MatchDto? match)
        => string.IsNullOrWhiteSpace(match?.Status)
            ? "UNKNOWN"
            : match.Status.Trim().ToUpperInvariant();

    private static bool IsFinalStatus(string? status)
        => status?.Trim().ToUpperInvariant() switch
        {
            null => false,
            "COMPLETED" => true,
            "CANCELLED" => true,
            "CANCELED" => true,
            "FINISHED" => true,
            "FINALIZED" => true,
            "ENDED" => true,
            "CLOSED" => true,
            "TERMINATED" => true,
            _ => false
        };

    public static string OfficialStatusCode(MatchDto? match, bool requestFailed = false)
    {
        if (requestFailed)
            return "UNAVAILABLE";

        return NormalizeStatus(match) switch
        {
            OfficialStatus.Finalized => "FINALIZED",
            OfficialStatus.Live => "LIVE",
            _ => "UNAVAILABLE"
        };
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
