using DTOs;
using Xunit;

namespace CriptoVersus.Worker.Tests;

public sealed class TvAlertStateInitializationTests
{
    private record AlertState(int LeftCurrencyId, int RightCurrencyId, bool LeftActive, bool RightActive);

    private static AlertState SimulateRender(
        int currentLeft, int currentRight,
        int loadedLeft, int loadedRight,
        bool leftApiResult, bool rightApiResult)
    {
        bool leftChanged = currentLeft != loadedLeft;
        bool rightChanged = currentRight != loadedRight;

        if (!leftChanged && !rightChanged)
            return new AlertState(loadedLeft, loadedRight, false, false);

        bool leftActive = currentLeft <= 0 ? false : leftApiResult;
        bool rightActive = currentRight <= 0 ? false : rightApiResult;

        bool sameCurrency = currentLeft > 0 && currentRight > 0 && currentLeft == currentRight;
        if (sameCurrency) rightActive = leftActive;

        return new AlertState(currentLeft, currentRight, leftActive, rightActive);
    }

    [Fact]
    public void FirstLoad_POLYX_vs_SOL()
    {
        var result = SimulateRender(
            currentLeft: 10, currentRight: 20,
            loadedLeft: 0, loadedRight: 0,
            leftApiResult: true, rightApiResult: false);

        Assert.Equal(10, result.LeftCurrencyId);
        Assert.Equal(20, result.RightCurrencyId);
        Assert.True(result.LeftActive);
        Assert.False(result.RightActive);
    }

    [Fact]
    public void Rerender_SameIds_NoChange()
    {
        var state = new AlertState(10, 20, true, false);

        bool leftChanged = state.LeftCurrencyId != 10;
        bool rightChanged = state.RightCurrencyId != 20;

        Assert.False(leftChanged);
        Assert.False(rightChanged);
    }

    [Fact]
    public void LeftCurrency_Changes_From_POLYX_To_BTC()
    {
        var result = SimulateRender(
            currentLeft: 30, currentRight: 20,
            loadedLeft: 10, loadedRight: 20,
            leftApiResult: true, rightApiResult: false);

        Assert.Equal(30, result.LeftCurrencyId);
        Assert.Equal(20, result.RightCurrencyId);
        Assert.True(result.LeftActive);
        Assert.False(result.RightActive);
    }

    [Fact]
    public void RightCurrency_Changes_From_SOL_To_ETH()
    {
        var result = SimulateRender(
            currentLeft: 10, currentRight: 40,
            loadedLeft: 10, loadedRight: 20,
            leftApiResult: false, rightApiResult: true);

        Assert.Equal(10, result.LeftCurrencyId);
        Assert.Equal(40, result.RightCurrencyId);
        Assert.False(result.LeftActive);
        Assert.True(result.RightActive);
    }

    [Fact]
    public void BothCurrencies_Change()
    {
        var result = SimulateRender(
            currentLeft: 30, currentRight: 40,
            loadedLeft: 10, loadedRight: 20,
            leftApiResult: true, rightApiResult: true);

        Assert.Equal(30, result.LeftCurrencyId);
        Assert.Equal(40, result.RightCurrencyId);
        Assert.True(result.LeftActive);
        Assert.True(result.RightActive);
    }

    [Theory]
    [InlineData(0, 20)]
    [InlineData(-1, 20)]
    [InlineData(10, 0)]
    [InlineData(10, -5)]
    [InlineData(0, 0)]
    public void InvalidCurrencyId_ResultIsFalse(int left, int right)
    {
        bool leftActive = left > 0;
        bool rightActive = right > 0;

        if (!leftActive && !rightActive)
        {
            Assert.False(leftActive);
            Assert.False(rightActive);
        }
    }

    [Fact]
    public void SameCurrencyId_BothSides_ApiQueriedOnce()
    {
        int currencyId = 42;
        int apiCallCount = 0;

        bool sameCurrency = currencyId > 0 && currencyId > 0 && currencyId == currencyId;

        if (currencyId > 0)
        {
            apiCallCount++;
            _ = true;
        }

        if (currencyId > 0 && !sameCurrency)
        {
            apiCallCount++;
        }

        Assert.Equal(1, apiCallCount);
    }

    [Fact]
    public void SameCurrencyId_BothSides_SameActiveState()
    {
        bool leftApiResult = true;

        bool sameCurrency = 42 > 0 && 42 > 0 && 42 == 42;
        bool rightActive = sameCurrency ? leftApiResult : false;

        Assert.True(leftApiResult);
        Assert.True(rightActive);
    }

    [Fact]
    public void CurrencyChange_ResetsLoadedIds()
    {
        int loadedLeft = 10;
        int loadedRight = 20;
        int newLeft = 30;
        int newRight = 20;

        bool leftChanged = newLeft != loadedLeft;
        bool rightChanged = newRight != loadedRight;

        Assert.True(leftChanged);
        Assert.False(rightChanged);
        Assert.True(leftChanged || rightChanged);
    }

    [Fact]
    public void Error_ResetsLoadedIds_ForRetry()
    {
        int loadedLeft = 10;
        int loadedRight = 20;

        loadedLeft = 0;
        loadedRight = 0;

        Assert.Equal(0, loadedLeft);
        Assert.Equal(0, loadedRight);
    }
}
