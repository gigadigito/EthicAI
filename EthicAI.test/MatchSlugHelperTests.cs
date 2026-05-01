using CriptoVersus.Web.Services;

namespace EthicAI.test;

public sealed class MatchSlugHelperTests
{
    private readonly MatchSlugHelper _helper = new();

    [Fact]
    public void NormalizeTicker_RemovesQuoteSuffixAndLowercases()
    {
        Assert.Equal("ada", _helper.NormalizeTicker("ADAUSDT"));
        Assert.Equal("bnb", _helper.NormalizeTicker("BNBUSDT"));
    }

    [Fact]
    public void BuildSlug_UsesSeoFriendlyFormat()
    {
        Assert.Equal("ada-vs-bnb", _helper.BuildSlug("ADAUSDT", "BNBUSDT"));
    }

    [Fact]
    public void ParseLegacySlug_NormalizesLegacySegments()
    {
        Assert.Equal("ada-vs-bnb", _helper.ParseLegacySlug("adausdt-vs-bnbusdt"));
    }
}
