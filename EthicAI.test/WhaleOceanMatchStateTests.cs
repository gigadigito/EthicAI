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

    [Theory]
    [InlineData("Completed")]
    [InlineData("Finished")]
    [InlineData("Finalized")]
    [InlineData("Cancelled")]
    public void Final_status_values_are_normalized_without_flow_data(string rawStatus)
    {
        var match = new MatchDto { Status = rawStatus, EndTime = null };

        Assert.Equal(WhaleOceanMatchState.OfficialStatus.Finalized, WhaleOceanMatchState.NormalizeStatus(match));
        Assert.Equal("FINALIZED", WhaleOceanMatchState.OfficialStatusCode(match));
    }

    [Fact]
    public void Missing_match_lookup_is_unavailable_instead_of_flow_pending()
    {
        Assert.Equal(WhaleOceanMatchState.OfficialStatus.Unavailable, WhaleOceanMatchState.NormalizeStatus(null));
        Assert.Equal("UNAVAILABLE", WhaleOceanMatchState.OfficialStatusCode(null, requestFailed: true));
    }
}
