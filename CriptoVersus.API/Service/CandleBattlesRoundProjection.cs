using System.Text.Json;
using BLL.NFTFutebol;
using DAL.NftFutebol;
using DTOs;

namespace CriptoVersus.API.Services;

public static class CandleBattlesRoundProjection
{
    public static CandleBattlesRoundDto ToDto(CandleBattlesRound round)
    {
        var left = JsonSerializer.Deserialize<CandleBattlesCandleDto>(round.LeftCandleJson)
            ?? throw new JsonException("Candle esquerdo ausente.");
        var right = JsonSerializer.Deserialize<CandleBattlesCandleDto>(round.RightCandleJson)
            ?? throw new JsonException("Candle direito ausente.");
        return new CandleBattlesRoundDto(
            $"{round.MatchId}:5m:{new DateTimeOffset(round.OpenTimeUtc).ToUnixTimeMilliseconds()}",
            round.MatchId, left, right, EffectiveWinner(round, left, right),
            CandleBattlesResolver.Version, round.LeftStrength, round.RightStrength);
    }

    public static string EffectiveWinner(CandleBattlesRound round)
    {
        if (round.RuleVersion == CandleBattlesResolver.Version) return round.Winner;
        var left = JsonSerializer.Deserialize<CandleBattlesCandleDto>(round.LeftCandleJson)
            ?? throw new JsonException("Candle esquerdo ausente.");
        var right = JsonSerializer.Deserialize<CandleBattlesCandleDto>(round.RightCandleJson)
            ?? throw new JsonException("Candle direito ausente.");
        return EffectiveWinner(round, left, right);
    }

    private static string EffectiveWinner(CandleBattlesRound round, CandleBattlesCandleDto left, CandleBattlesCandleDto right)
        => round.RuleVersion == CandleBattlesResolver.Version ? round.Winner :
            CandleBattlesResolver.ResolveWinner(left, right, round.LeftStrength, round.RightStrength);
}
