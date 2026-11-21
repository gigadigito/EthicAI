using System.Security.Cryptography;
using System.Text;

namespace CriptoVersus.Web.Services;

/// <summary>
/// Fail-closed authorization for the technical Arena Pressure capture surface.
/// Development keeps the local workflow available; every other environment requires
/// an explicit enable flag and a key supplied in a request header.
/// </summary>
public static class ArenaPressureCaptureAccess
{
    public const string HeaderName = "X-Arena-Capture-Key";
    public const string EnabledKey = "ArenaPressureCapture:Enabled";
    public const string AccessKey = "ArenaPressureCapture:AccessKey";

    public static bool IsEnabled(IHostEnvironment environment, IConfiguration configuration)
        => environment.IsDevelopment() || configuration.GetValue<bool>(EnabledKey);

    public static bool IsAuthorized(
        HttpContext context,
        IHostEnvironment environment,
        IConfiguration configuration)
    {
        if (environment.IsDevelopment())
            return true;

        if (!configuration.GetValue<bool>(EnabledKey))
            return false;

        var expected = configuration[AccessKey];
        if (string.IsNullOrWhiteSpace(expected)
            || !context.Request.Headers.TryGetValue(HeaderName, out var suppliedValues))
        {
            return false;
        }

        var supplied = suppliedValues.ToString();
        if (string.IsNullOrWhiteSpace(supplied))
            return false;

        var expectedBytes = Encoding.UTF8.GetBytes(expected);
        var suppliedBytes = Encoding.UTF8.GetBytes(supplied);
        return expectedBytes.Length == suppliedBytes.Length
               && CryptographicOperations.FixedTimeEquals(expectedBytes, suppliedBytes);
    }
}
