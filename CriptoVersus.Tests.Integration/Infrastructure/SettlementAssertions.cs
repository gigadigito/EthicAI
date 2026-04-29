namespace CriptoVersus.Tests.Integration.Infrastructure;

public static class SettlementAssertions
{
    public static decimal RoundMoney(decimal value)
        => Math.Round(value, 8, MidpointRounding.ToZero);

    public static decimal ComputeWinnerPayout(decimal winnerStake, decimal totalWinnerStake, decimal totalLoserStake, decimal houseFeeRate, decimal loserRefundRate)
    {
        var platformFee = RoundMoney(totalLoserStake * houseFeeRate);
        var loserRefundPool = RoundMoney(totalLoserStake * loserRefundRate);
        var distributablePool = RoundMoney(totalLoserStake - platformFee - loserRefundPool);
        var share = totalWinnerStake == 0m ? 0m : winnerStake / totalWinnerStake;
        return RoundMoney(winnerStake + RoundMoney(share * distributablePool));
    }

    public static decimal ComputeLoserRefund(decimal loserStake, decimal totalLoserStake, decimal loserRefundRate)
    {
        var loserRefundPool = RoundMoney(totalLoserStake * loserRefundRate);
        var share = totalLoserStake == 0m ? 0m : loserStake / totalLoserStake;
        return RoundMoney(share * loserRefundPool);
    }

    public static UserMatchHistoryItemDto FindMatch(UserMatchHistoryPageDto history, int matchId)
    {
        var item = history.Items.FirstOrDefault(x => x.MatchId == matchId);
        return item ?? throw new Xunit.Sdk.XunitException($"Nao foi encontrado wallet-history para a partida {matchId}.");
    }

    public static InternalTestLedgerEntryDto FindLastLedger(IReadOnlyList<InternalTestLedgerEntryDto> ledger, string type)
    {
        var item = ledger.LastOrDefault(x => string.Equals(x.Type, type, StringComparison.OrdinalIgnoreCase));
        return item ?? throw new Xunit.Sdk.XunitException($"Nao foi encontrado ledger do tipo {type}.");
    }
}
