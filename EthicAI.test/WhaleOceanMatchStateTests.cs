using DTOs;
using CriptoVersus.Web.Services;

namespace EthicAI.test;

public sealed class WhaleOceanMatchStateTests
{
    [Fact]
    public void Completed_match_is_finalized_even_when_end_time_is_missing()
    {
        var match = new MatchDto { Status = "Completed", IsFinished = false };

        Assert.True(WhaleOceanMatchState.IsFinished(match));
    }

    [Fact]
    public void Official_end_time_is_enough_to_mark_match_finalized()
    {
        var match = new MatchDto
        {
            Status = "Ongoing",
            EndTime = new DateTime(2026, 11, 12, 17, 30, 0, DateTimeKind.Unspecified)
        };

        Assert.True(WhaleOceanMatchState.IsFinished(match));
    }

    [Fact]
    public void Missing_end_time_does_not_create_a_display_value()
    {
        var match = new MatchDto { Status = "Completed", EndTime = null };

        Assert.True(WhaleOceanMatchState.IsFinished(match));
        Assert.Null(match.EndTime);
    }

    [Fact]
    public void End_time_is_formatted_as_utc_without_using_local_time()
    {
        var endTime = new DateTime(2026, 11, 12, 17, 30, 0, DateTimeKind.Local);

        Assert.Equal("12/11/2026", WhaleOceanMatchState.FormatEndDateUtc(endTime, "pt-BR"));
        Assert.Equal("17:30:00", WhaleOceanMatchState.FormatEndClockUtc(endTime));
    }
}
