using BLL;
using CriptoVersus.Worker;
using static BLL.BinanceService;

namespace CriptoVersus.Worker.Tests;

public sealed class PriceSymbolSetBuilderTests
{
    [Theory]
    [InlineData("XEC", "XECUSDT")]
    [InlineData("XECUSDT", "XECUSDT")]
    [InlineData(" zbtusdt ", "ZBTUSDT")]
    public void NormalizeSymbol_StripsWhitespaceAndUppercases(string input, string expected)
    {
        Assert.Equal(expected, PriceSymbolSetBuilder.NormalizeSymbol(input));
    }

    [Fact]
    public void BuildRequiredSymbols_DeduplicatesTopGainersAndActiveMatches()
    {
        var required = PriceSymbolSetBuilder.BuildRequiredSymbols(
            topGainerSymbols: new[] { "XECUSDT", "BTCUSDT" },
            activeMatchSymbols: new[] { "xec", "XECUSDT", "ZBTUSDT" },
            conversionSymbols: new[] { "BTCUSDT", "ETHUSDT" });

        Assert.Equal(4, required.Count);
        Assert.Contains("XECUSDT", required);
        Assert.Contains("ZBTUSDT", required);
        Assert.Contains("BTCUSDT", required);
        Assert.Contains("ETHUSDT", required);
    }

    [Fact]
    public void BuildSnapshot_IncludesActiveMatchSymbolEvenWhenItIsNotATopGainer()
    {
        var allUsdt = new List<Crypto>
        {
            new() { Symbol = "BTCUSDT", LastPrice = "100", PriceChangePercent = "1.0", QuoteVolume = "1000", Count = 10 },
            new() { Symbol = "XECUSDT", LastPrice = "0.0001", PriceChangePercent = "2.0", QuoteVolume = "500", Count = 5 }
        };

        var requiredSymbols = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "XECUSDT"
        };

        var snapshot = PriceSymbolSetBuilder.BuildSnapshot(allUsdt, requiredSymbols);

        Assert.Single(snapshot);
        Assert.Equal("XECUSDT", snapshot[0].Symbol);
        Assert.Equal(0.0001m, snapshot[0].LastPrice);
    }
}

