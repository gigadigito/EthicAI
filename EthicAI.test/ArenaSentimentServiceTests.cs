using System.Net;
using System.Net.Http;
using System.Text;
using BLL.ArenaSentiment;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

public class ArenaSentimentServiceTests
{
    [Fact]
    public async Task GetArenaSentimentAsync_SpotOnlySymbol_SkipsFuturesMetricEndpoints()
    {
        using var db = CreateDbContext();
        using var cache = new MemoryCache(new MemoryCacheOptions());
        using var handler = new ArenaSentimentHttpHandler(exchangeInfoJson: """
            {
              "symbols": [
                { "symbol": "BTCUSDT", "quoteAsset": "USDT", "contractType": "PERPETUAL" }
              ]
            }
            """);
        using var httpClient = new HttpClient(handler);

        var service = CreateService(httpClient, db, cache);

        var sentiment = await service.GetArenaSentimentAsync("RLUSDUSDT");

        Assert.Equal("RLUSDUSDT", sentiment.Symbol);
        Assert.Null(sentiment.FundingScore);
        Assert.Null(sentiment.LongShortScore);

        var calls = handler.Requests.ToArray();
        Assert.DoesNotContain(calls, url => url.Contains("/fapi/v1/fundingRate?symbol=RLUSDUSDT", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(calls, url => url.Contains("/fapi/v1/openInterest?symbol=RLUSDUSDT", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(calls, url => url.Contains("/futures/data/openInterestHist?symbol=RLUSDUSDT", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(calls, url => url.Contains("/futures/data/globalLongShortAccountRatio?symbol=RLUSDUSDT", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(calls, url => url.Contains("/futures/data/takerlongshortRatio?symbol=RLUSDUSDT", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task GetArenaSentimentAsync_ExchangeInfoUnavailable_FallsBackToFuturesRequests()
    {
        using var db = CreateDbContext();
        using var cache = new MemoryCache(new MemoryCacheOptions());
        using var handler = new ArenaSentimentHttpHandler(exchangeInfoStatusCode: HttpStatusCode.InternalServerError);
        using var httpClient = new HttpClient(handler);

        var service = CreateService(httpClient, db, cache);

        var sentiment = await service.GetArenaSentimentAsync("BTCUSDT");

        Assert.Equal("BTCUSDT", sentiment.Symbol);
        Assert.NotNull(sentiment.FundingScore);
        Assert.NotNull(sentiment.LongShortScore);

        var calls = handler.Requests.ToArray();
        Assert.Contains(calls, url => url.Contains("/fapi/v1/fundingRate?symbol=BTCUSDT", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(calls, url => url.Contains("/futures/data/openInterestHist?symbol=BTCUSDT", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(calls, url => url.Contains("/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(calls, url => url.Contains("/futures/data/takerlongshortRatio?symbol=BTCUSDT", StringComparison.OrdinalIgnoreCase));
    }

    private static ArenaSentimentService CreateService(HttpClient httpClient, EthicAIDbContext db, IMemoryCache cache)
    {
        return new ArenaSentimentService(
            httpClient,
            db,
            cache,
            NullLogger<ArenaSentimentService>.Instance,
            Options.Create(new ArenaSentimentOptions()));
    }

    private static EthicAIDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<EthicAIDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new EthicAIDbContext(options);
    }

    private sealed class ArenaSentimentHttpHandler : HttpMessageHandler
    {
        private readonly string _exchangeInfoJson;
        private readonly HttpStatusCode _exchangeInfoStatusCode;

        public ArenaSentimentHttpHandler(
            string? exchangeInfoJson = null,
            HttpStatusCode exchangeInfoStatusCode = HttpStatusCode.OK)
        {
            _exchangeInfoJson = exchangeInfoJson ?? """
                {
                  "symbols": [
                    { "symbol": "BTCUSDT", "quoteAsset": "USDT", "contractType": "PERPETUAL" }
                  ]
                }
                """;
            _exchangeInfoStatusCode = exchangeInfoStatusCode;
        }

        public List<string> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var url = request.RequestUri!.ToString();
            Requests.Add(url);

            var path = request.RequestUri!.AbsolutePath;
            var query = request.RequestUri.Query;

            if (path == "/api/v3/ticker/24hr")
                return Task.FromResult(Json("""{ "priceChangePercent": "2.5", "quoteVolume": "1500000" }"""));

            if (path == "/api/v3/klines")
                return Task.FromResult(Json("""
                    [
                      [0,"100","103","99","102","10",0,"1000",5,"6","600"],
                      [0,"102","104","101","103","12",0,"1100",6,"7","700"],
                      [0,"103","105","102","104","11",0,"1200",6,"6","650"],
                      [0,"104","106","103","105","10",0,"1300",7,"7","750"],
                      [0,"105","108","104","107","15",0,"1400",8,"9","900"],
                      [0,"107","109","106","108","13",0,"1450",8,"8","850"],
                      [0,"108","110","107","109","14",0,"1500",9,"9","950"],
                      [0,"109","112","108","111","18",0,"1600",10,"11","1000"]
                    ]
                    """));

            if (path == "/api/v3/depth")
                return Task.FromResult(Json("""{ "bids": [["1","100"]], "asks": [["1","50"]] }"""));

            if (path == "/fapi/v1/exchangeInfo")
                return Task.FromResult(Json(_exchangeInfoJson, _exchangeInfoStatusCode));

            if (path == "/fapi/v1/fundingRate")
                return Task.FromResult(Json("""[{ "fundingRate": "0.001" }]"""));

            if (path == "/fapi/v1/openInterest")
                return Task.FromResult(Json("""{ "openInterest": "1200" }"""));

            if (path == "/futures/data/openInterestHist")
                return Task.FromResult(Json("""[{ "sumOpenInterest": "1000" }, { "sumOpenInterest": "1100" }]"""));

            if (path == "/futures/data/globalLongShortAccountRatio")
                return Task.FromResult(Json("""[{ "longShortRatio": "1.2" }]"""));

            if (path == "/futures/data/takerlongshortRatio")
                return Task.FromResult(Json("""[{ "buySellRatio": "1.3" }]"""));

            throw new InvalidOperationException($"Unhandled request: {url}");
        }

        private static HttpResponseMessage Json(string json, HttpStatusCode statusCode = HttpStatusCode.OK)
        {
            return new HttpResponseMessage(statusCode)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
        }
    }
}
