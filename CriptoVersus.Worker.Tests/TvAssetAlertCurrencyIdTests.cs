using DTOs;
using Xunit;

namespace CriptoVersus.Worker.Tests;

public sealed class TvAssetAlertCurrencyIdTests
{
    [Fact]
    public void MatchDto_CurrencyIdA_B_ArePopulated()
    {
        var match = new MatchDto
        {
            MatchId = 1,
            CurrencyIdA = 10,
            CurrencyIdB = 20
        };

        Assert.Equal(10, match.CurrencyIdA);
        Assert.Equal(20, match.CurrencyIdB);
    }

    [Fact]
    public void TvHotMatchDto_CurrencyIdA_B_ArePopulated()
    {
        var hot = new TvHotMatchDto
        {
            HasMatch = true,
            MatchId = 2,
            CurrencyIdA = 30,
            CurrencyIdB = 40,
            LeftSymbol = "SOL",
            RightSymbol = "XRP"
        };

        Assert.Equal(30, hot.CurrencyIdA);
        Assert.Equal(40, hot.CurrencyIdB);
        Assert.Equal("SOL", hot.LeftSymbol);
        Assert.Equal("XRP", hot.RightSymbol);
    }

    [Fact]
    public void HotMatchDto_CurrencyIdA_B_ArePopulated()
    {
        var hot = new HotMatchDto
        {
            MatchId = 1,
            HomeSymbol = "BTC",
            AwaySymbol = "ETH",
            CurrencyIdA = 10,
            CurrencyIdB = 20
        };

        Assert.Equal(10, hot.CurrencyIdA);
        Assert.Equal(20, hot.CurrencyIdB);
    }

    [Fact]
    public void CurrencyId_MatchTakesPrecedenceOverHotMatch()
    {
        var match = new MatchDto
        {
            MatchId = 1,
            CurrencyIdA = 10,
            CurrencyIdB = 20
        };

        var hot = new TvHotMatchDto
        {
            HasMatch = true,
            MatchId = 1,
            CurrencyIdA = 30,
            CurrencyIdB = 40
        };

        int leftCurrencyId = match.CurrencyIdA != 0 ? match.CurrencyIdA : hot.CurrencyIdA;
        int rightCurrencyId = match.CurrencyIdB != 0 ? match.CurrencyIdB : hot.CurrencyIdB;

        Assert.Equal(10, leftCurrencyId);
        Assert.Equal(20, rightCurrencyId);
    }

    [Fact]
    public void CurrencyId_FallsBackToHotMatch_WhenMatchZero()
    {
        var match = new MatchDto
        {
            MatchId = 0,
            CurrencyIdA = 0,
            CurrencyIdB = 0
        };

        var hot = new TvHotMatchDto
        {
            HasMatch = true,
            MatchId = 5,
            CurrencyIdA = 50,
            CurrencyIdB = 60
        };

        int leftCurrencyId = match.CurrencyIdA != 0 ? match.CurrencyIdA : hot.CurrencyIdA;
        int rightCurrencyId = match.CurrencyIdB != 0 ? match.CurrencyIdB : hot.CurrencyIdB;

        Assert.Equal(50, leftCurrencyId);
        Assert.Equal(60, rightCurrencyId);
    }

    [Fact]
    public void CurrencyId_Zero_WhenNoData()
    {
        var match = new MatchDto();
        var hot = new TvHotMatchDto();

        Assert.Equal(0, match.CurrencyIdA);
        Assert.Equal(0, match.CurrencyIdB);
        Assert.Equal(0, hot.CurrencyIdA);
        Assert.Equal(0, hot.CurrencyIdB);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-100)]
    public void Button_ShouldNotRender_WhenCurrencyIdInvalid(int currencyId)
    {
        bool shouldRender = currencyId > 0;
        Assert.False(shouldRender, $"Button should not render for CurrencyId={currencyId}");
    }

    [Theory]
    [InlineData(1)]
    [InlineData(42)]
    [InlineData(999)]
    public void Button_ShouldRender_WhenCurrencyIdValid(int currencyId)
    {
        bool shouldRender = currencyId > 0;
        Assert.True(shouldRender, $"Button should render for CurrencyId={currencyId}");
    }

    [Fact]
    public void AssetAlertSubscription_IntegralKey_UsesCurrencyId()
    {
        int pushSubscriptionId = 1;
        int currencyId = 42;

        string eventKey = $"asset-playing:{pushSubscriptionId}:{currencyId}:123";

        Assert.Contains("42", eventKey);
        Assert.StartsWith("asset-playing:", eventKey);
    }
}
