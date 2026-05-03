using System.Globalization;
using Microsoft.JSInterop;
using TimeZoneConverter;

namespace CriptoVersus.Web.Services;

public sealed class BrowserTimeZoneService
{
    public const string FallbackTimeZoneId = "America/Sao_Paulo";

    private readonly IJSRuntime _jsRuntime;
    private TimeZoneInfo _timeZone = TZConvert.GetTimeZoneInfo(FallbackTimeZoneId);
    private string _timeZoneId = FallbackTimeZoneId;
    private bool _initialized;

    public BrowserTimeZoneService(IJSRuntime jsRuntime)
    {
        _jsRuntime = jsRuntime;
    }

    public string TimeZoneId => _timeZoneId;

    public TimeZoneInfo TimeZone => _timeZone;

    public async Task EnsureInitializedAsync()
    {
        if (_initialized)
            return;

        try
        {
            var browserTimeZoneId = await _jsRuntime.InvokeAsync<string>("userTime.getTimeZone");
            SetTimeZone(browserTimeZoneId);
        }
        catch
        {
            SetTimeZone(null);
        }

        _initialized = true;
    }

    public DateTime? ConvertUtcToLocal(DateTime? utc)
        => utc.HasValue ? ConvertUtcToLocal(utc.Value) : null;

    public DateTime ConvertUtcToLocal(DateTime utc)
    {
        var normalizedUtc = NormalizeUtc(utc);
        return TimeZoneInfo.ConvertTimeFromUtc(normalizedUtc, _timeZone);
    }

    public DateTimeOffset? ConvertUtcToLocal(DateTimeOffset? utc)
        => utc.HasValue ? ConvertUtcToLocal(utc.Value) : null;

    public DateTimeOffset ConvertUtcToLocal(DateTimeOffset utc)
        => TimeZoneInfo.ConvertTime(utc, _timeZone);

    public string FormatDateTime(DateTime? utc, string cultureName = "pt-BR", bool includeSeconds = false)
    {
        if (!utc.HasValue)
            return "-";

        var format = includeSeconds
            ? ResolveDateTimeFormat(cultureName, includeTime: true, includeSeconds: true)
            : ResolveDateTimeFormat(cultureName, includeTime: true, includeSeconds: false);

        return ConvertUtcToLocal(utc.Value).ToString(format, ResolveCulture(cultureName));
    }

    public string FormatDate(DateTime? utc, string cultureName = "pt-BR")
    {
        if (!utc.HasValue)
            return "-";

        return ConvertUtcToLocal(utc.Value).ToString(
            ResolveDateTimeFormat(cultureName, includeTime: false, includeSeconds: false),
            ResolveCulture(cultureName));
    }

    public string FormatDateTimeOffset(DateTimeOffset? utc, string cultureName = "pt-BR", bool includeSeconds = false)
    {
        if (!utc.HasValue)
            return "-";

        var format = includeSeconds
            ? ResolveDateTimeFormat(cultureName, includeTime: true, includeSeconds: true)
            : ResolveDateTimeFormat(cultureName, includeTime: true, includeSeconds: false);

        return ConvertUtcToLocal(utc.Value).ToString(format, ResolveCulture(cultureName));
    }

    private void SetTimeZone(string? browserTimeZoneId)
    {
        var resolvedTimeZoneId = string.IsNullOrWhiteSpace(browserTimeZoneId)
            ? FallbackTimeZoneId
            : browserTimeZoneId.Trim();

        try
        {
            _timeZone = TZConvert.GetTimeZoneInfo(resolvedTimeZoneId);
            _timeZoneId = resolvedTimeZoneId;
        }
        catch
        {
            _timeZone = TZConvert.GetTimeZoneInfo(FallbackTimeZoneId);
            _timeZoneId = FallbackTimeZoneId;
        }
    }

    private static DateTime NormalizeUtc(DateTime value)
        => value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
        };

    private static CultureInfo ResolveCulture(string? cultureName)
    {
        if (string.IsNullOrWhiteSpace(cultureName))
            return CultureInfo.GetCultureInfo("pt-BR");

        try
        {
            return CultureInfo.GetCultureInfo(cultureName);
        }
        catch (CultureNotFoundException)
        {
            return CultureInfo.GetCultureInfo("pt-BR");
        }
    }

    private static string ResolveDateTimeFormat(string? cultureName, bool includeTime, bool includeSeconds)
    {
        var isPortuguese = string.IsNullOrWhiteSpace(cultureName)
            || cultureName.StartsWith("pt", StringComparison.OrdinalIgnoreCase);

        if (!includeTime)
            return isPortuguese ? "dd/MM/yyyy" : "MMM d, yyyy";

        if (isPortuguese)
            return includeSeconds ? "dd/MM/yyyy HH:mm:ss" : "dd/MM/yyyy HH:mm";

        return includeSeconds ? "MMM d, yyyy h:mm:ss tt" : "MMM d, yyyy h:mm tt";
    }
}
