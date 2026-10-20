using BLL.NFTFutebol;
using CriptoVersus.API.Services;
using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Tests;

/// <summary>Helpers compartilhados dos testes de Price Crossover.</summary>
internal static class PriceCrossoverTestHelpers
{
    public static EthicAIDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<EthicAIDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new EthicAIDbContext(options);
    }

    public static IConfiguration CreateConfiguration(params (string Key, string Value)[] entries)
    {
        var values = entries.ToDictionary(entry => entry.Key, entry => (string?)entry.Value);
        return new ConfigurationBuilder()
            .AddInMemoryCollection(values)
            .Build();
    }

    public static PriceCrossoverSocialService CreateSocialService(
        EthicAIDbContext db,
        PriceCrossoverOptions? options = null,
        IConfiguration? configuration = null)
    {
        var resolved = options ?? new PriceCrossoverOptions();

        return new PriceCrossoverSocialService(
            db,
            new PriceCrossoverAnalyzer(),
            new PriceCrossoverSocialNarrativeService(),
            new PriceCrossoverPublicationService(db, Options.Create(resolved)),
            Options.Create(resolved),
            configuration ?? CreateConfiguration());
    }

    public static PriceCrossoverHighlightSelector CreateSelector(
        EthicAIDbContext db,
        PriceCrossoverOptions? options = null,
        IConfiguration? configuration = null)
    {
        var resolved = options ?? new PriceCrossoverOptions();
        var social = CreateSocialService(db, resolved, configuration);
        var publication = new PriceCrossoverPublicationService(db, Options.Create(resolved));

        return new PriceCrossoverHighlightSelector(
            db,
            social,
            publication,
            Options.Create(resolved));
    }

    /// <summary>
    /// Cria uma partida com times, moedas e snapshots de preco.
    /// <paramref name="pricesA"/> e <paramref name="pricesB"/> sao precos por passo de 30 segundos.
    /// <paramref name="missingCurrency"/> simula times sem moeda cadastrada (sem simbolo).
    /// </summary>
    public static Match SeedMatch(
        EthicAIDbContext db,
        int matchId,
        string symbolA = "EPICUSDT",
        string symbolB = "EIGENUSDT",
        MatchStatus status = MatchStatus.Completed,
        int scoreA = 0,
        int scoreB = 0,
        int? winnerTeamId = null,
        DateTime? startTimeUtc = null,
        DateTime? endTimeUtc = null,
        decimal[]? pricesA = null,
        decimal[]? pricesB = null,
        decimal[]? percentagesA = null,
        decimal[]? percentagesB = null,
        bool skipSnapshots = false,
        bool missingCurrency = false)
    {
        var baseId = matchId * 1000;
        Team teamA;
        Team teamB;

        if (missingCurrency)
        {
            // Times apontando para moedas inexistentes: simbolo fica vazio e nunca e inventado.
            teamA = new Team { TeamId = baseId + 11, CurrencyId = baseId + 999, Currency = null! };
            teamB = new Team { TeamId = baseId + 12, CurrencyId = baseId + 998, Currency = null! };
        }
        else
        {
            var currencyA = new Currency
            {
                CurrencyId = baseId + 1,
                Name = symbolA,
                Symbol = symbolA,
                LastUpdated = DateTime.UtcNow
            };
            var currencyB = new Currency
            {
                CurrencyId = baseId + 2,
                Name = symbolB,
                Symbol = symbolB,
                LastUpdated = DateTime.UtcNow
            };

            teamA = new Team { TeamId = baseId + 11, CurrencyId = currencyA.CurrencyId, Currency = currencyA };
            teamB = new Team { TeamId = baseId + 12, CurrencyId = currencyB.CurrencyId, Currency = currencyB };

            db.Currency.AddRange(currencyA, currencyB);
        }

        db.Team.AddRange(teamA, teamB);

        var start = startTimeUtc ?? (endTimeUtc ?? DateTime.UtcNow.AddMinutes(-90)).AddMinutes(-90);
        var end = endTimeUtc ?? start.AddMinutes(90);

        var match = new Match
        {
            MatchId = matchId,
            TeamAId = teamA.TeamId,
            TeamBId = teamB.TeamId,
            TeamA = teamA,
            TeamB = teamB,
            Status = status,
            StartTime = start,
            EndTime = end,
            ScoreA = scoreA,
            ScoreB = scoreB,
            WinnerTeamId = winnerTeamId ?? (status == MatchStatus.Completed && scoreA != scoreB
                ? (scoreA > scoreB ? teamA.TeamId : teamB.TeamId)
                : null),
            EndReasonCode = status == MatchStatus.Completed ? "TIME_LIMIT" : null
        };

        db.Match.Add(match);

        if (!skipSnapshots)
        {
            pricesA ??= BuildPrices(30, 1.00m, 0.02m);
            pricesB ??= BuildPrices(30, 1.00m, -0.01m);

            for (var i = 0; i < Math.Max(pricesA.Length, pricesB.Length); i++)
            {
                var capturedAt = start.AddSeconds(i * 30);

                if (i < pricesA.Length)
                {
                    db.Set<MatchMetricSnapshot>().Add(new MatchMetricSnapshot
                    {
                        MatchId = matchId,
                        TeamId = teamA.TeamId,
                        CapturedAtUtc = capturedAt,
                        LastPrice = pricesA[i],
                        PercentageChange = percentagesA is not null && i < percentagesA.Length ? percentagesA[i] : 0m
                    });
                }

                if (i < pricesB.Length)
                {
                    db.Set<MatchMetricSnapshot>().Add(new MatchMetricSnapshot
                    {
                        MatchId = matchId,
                        TeamId = teamB.TeamId,
                        CapturedAtUtc = capturedAt,
                        LastPrice = pricesB[i],
                        PercentageChange = percentagesB is not null && i < percentagesB.Length ? percentagesB[i] : 0m
                    });
                }
            }
        }

        db.SaveChanges();
        return match;
    }

    public static decimal[] BuildPrices(int count, decimal startPrice, decimal stepPercent)
    {
        var prices = new decimal[count];
        var current = startPrice;

        for (var i = 0; i < count; i++)
        {
            prices[i] = decimal.Round(current, 8, MidpointRounding.AwayFromZero);
            current *= 1m + stepPercent;
        }

        return prices;
    }
}
