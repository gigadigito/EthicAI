using DTOs;

namespace CriptoVersus.Web.Services;

public static class TvProceduralCyclePolicy
{
    public static HotMatchDto? FindNextMatch(IEnumerable<HotMatchDto> candidates)
        => candidates.FirstOrDefault(candidate => !IsTerminal(candidate.IsFinished, candidate.Status));

    public static bool IsTerminal(bool isFinished, string? status)
    {
        if (isFinished)
            return true;

        if (string.IsNullOrWhiteSpace(status))
            return false;

        return status.Trim().ToUpperInvariant() switch
        {
            "COMPLETED" => true,
            "CANCELLED" => true,
            "CANCELED" => true,
            "CLOSED" => true,
            "SETTLED" => true,
            "FINISHED" => true,
            "EXPIRED" => true,
            "ABORTED" => true,
            _ => false
        };
    }
}
