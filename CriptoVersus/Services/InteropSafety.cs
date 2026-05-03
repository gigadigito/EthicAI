using Microsoft.JSInterop;

namespace CriptoVersus.Web.Services;

public static class InteropSafety
{
    public static bool IsDeferredInteropException(Exception ex)
        => ex is JSDisconnectedException
            || ex is InvalidOperationException invalidOperation
                && invalidOperation.Message.Contains("statically rendered", StringComparison.OrdinalIgnoreCase);
}
