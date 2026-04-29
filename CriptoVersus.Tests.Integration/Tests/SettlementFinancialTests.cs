using CriptoVersus.Tests.Integration.Infrastructure;

namespace CriptoVersus.Tests.Integration.Tests;

public sealed class SettlementFinancialTests
{
    private readonly ITestOutputHelper _output;
    private readonly IntegrationTestSettings _settings;

    public SettlementFinancialTests(ITestOutputHelper output)
    {
        _output = output;
        _settings = IntegrationTestSettings.Load();
    }

    [ProductionIntegrationFact]
    public async Task Aposta_Com_Resultado_0x0_Deve_Devolver_Principal_Sem_Taxa()
    {
        using var api = new CriptoVersusApiClient(_settings);
        var factory = new TestDataFactory(api, _settings);
        var scenario = await factory.CreateTwoSidedScenarioAsync();

        var walletAAfterBet = await api.GetMyWalletAsync(scenario.UserA.Token);
        var walletBAfterBet = await api.GetMyWalletAsync(scenario.UserB!.Token);
        var settlement = await api.ScoreAndSettleAsync(scenario.Match.MatchId, 0, 0);

        var historyA = await api.GetWalletHistoryAsync(scenario.UserA.Token, scenario.UserA.UserId, scenario.Match.TeamAId);
        var historyB = await api.GetWalletHistoryAsync(scenario.UserB.Token, scenario.UserB.UserId, scenario.Match.TeamBId);
        var betA = SettlementAssertions.FindMatch(historyA, scenario.Match.MatchId);
        var betB = SettlementAssertions.FindMatch(historyB, scenario.Match.MatchId);

        var claimA = await api.ClaimAsync(scenario.UserA.Token);
        var claimB = await api.ClaimAsync(scenario.UserB.Token);
        var ledgerA = await api.GetLedgerAsync(scenario.UserA.Wallet);
        var ledgerB = await api.GetLedgerAsync(scenario.UserB.Wallet);

        LogScenario("0x0", scenario, settlement, walletAAfterBet, walletBAfterBet, betA, betB, claimA, claimB, ledgerA, ledgerB);

        Assert.Equal("DRAW_ZERO_ZERO", settlement.EndReasonCode);
        Assert.Null(betA.IsWinner);
        Assert.Null(betB.IsWinner);
        Assert.Equal(scenario.StakeA, betA.PayoutAmount);
        Assert.Equal(scenario.StakeB, betB.PayoutAmount);
        Assert.Equal(0m, settlement.HouseFeeAmount);
        Assert.Equal(scenario.UserA.InitialBalance, claimA.SystemBalance);
        Assert.Equal(scenario.UserB.InitialBalance, claimB.SystemBalance);
        Assert.Equal("CLAIM", SettlementAssertions.FindLastLedger(ledgerA, "CLAIM").Type);
        Assert.Equal("CLAIM", SettlementAssertions.FindLastLedger(ledgerB, "CLAIM").Type);
    }

    [ProductionIntegrationFact]
    public async Task Aposta_Com_Resultado_1x0_Deve_Pagar_Usuario_Vencedor()
    {
        using var api = new CriptoVersusApiClient(_settings);
        var factory = new TestDataFactory(api, _settings);
        var scenario = await factory.CreateTwoSidedScenarioAsync();

        var walletAAfterBet = await api.GetMyWalletAsync(scenario.UserA.Token);
        var walletBAfterBet = await api.GetMyWalletAsync(scenario.UserB!.Token);
        var settlement = await api.ScoreAndSettleAsync(scenario.Match.MatchId, 1, 0);

        var historyA = await api.GetWalletHistoryAsync(scenario.UserA.Token, scenario.UserA.UserId, scenario.Match.TeamAId);
        var historyB = await api.GetWalletHistoryAsync(scenario.UserB.Token, scenario.UserB.UserId, scenario.Match.TeamBId);
        var betA = SettlementAssertions.FindMatch(historyA, scenario.Match.MatchId);
        var betB = SettlementAssertions.FindMatch(historyB, scenario.Match.MatchId);

        var expectedWinnerPayout = SettlementAssertions.ComputeWinnerPayout(
            scenario.StakeA,
            scenario.StakeA,
            scenario.StakeB,
            _settings.HouseFeeRate,
            _settings.LoserRefundRate);

        var expectedLoserRefund = SettlementAssertions.ComputeLoserRefund(
            scenario.StakeB,
            scenario.StakeB,
            _settings.LoserRefundRate);

        var claimA = await api.ClaimAsync(scenario.UserA.Token);
        var claimB = await api.ClaimAsync(scenario.UserB.Token);
        var ledgerA = await api.GetLedgerAsync(scenario.UserA.Wallet);
        var ledgerB = await api.GetLedgerAsync(scenario.UserB.Wallet);

        LogScenario("1x0 winner", scenario, settlement, walletAAfterBet, walletBAfterBet, betA, betB, claimA, claimB, ledgerA, ledgerB);

        Assert.True(betA.IsWinner);
        Assert.False(betB.IsWinner);
        Assert.Equal(expectedWinnerPayout, betA.PayoutAmount);
        Assert.Equal(expectedLoserRefund, betB.PayoutAmount);
        Assert.Equal(SettlementAssertions.RoundMoney(scenario.UserA.InitialBalance - scenario.StakeA + expectedWinnerPayout), claimA.SystemBalance);
        Assert.Equal(SettlementAssertions.RoundMoney(scenario.UserB.InitialBalance - scenario.StakeB + expectedLoserRefund), claimB.SystemBalance);
        Assert.Equal(expectedWinnerPayout, SettlementAssertions.FindLastLedger(ledgerA, "CLAIM").Amount);
    }

    [ProductionIntegrationFact]
    public async Task Aposta_Com_Resultado_0x1_Deve_Registrar_Derrota_Com_Reembolso_Parcial_Configurado()
    {
        using var api = new CriptoVersusApiClient(_settings);
        var factory = new TestDataFactory(api, _settings);
        var scenario = await factory.CreateTwoSidedScenarioAsync();

        var walletAAfterBet = await api.GetMyWalletAsync(scenario.UserA.Token);
        var walletBAfterBet = await api.GetMyWalletAsync(scenario.UserB!.Token);
        var settlement = await api.ScoreAndSettleAsync(scenario.Match.MatchId, 0, 1);

        var historyA = await api.GetWalletHistoryAsync(scenario.UserA.Token, scenario.UserA.UserId, scenario.Match.TeamAId);
        var betA = SettlementAssertions.FindMatch(historyA, scenario.Match.MatchId);

        var expectedLoserRefund = SettlementAssertions.ComputeLoserRefund(
            scenario.StakeA,
            scenario.StakeA,
            _settings.LoserRefundRate);

        var claimA = await api.ClaimAsync(scenario.UserA.Token);
        var ledgerA = await api.GetLedgerAsync(scenario.UserA.Wallet);

        LogScenario("0x1 loser", scenario, settlement, walletAAfterBet, walletBAfterBet, betA, null, claimA, null, ledgerA, null);

        Assert.False(betA.IsWinner);
        Assert.True(betA.IsLoser);
        Assert.Equal(expectedLoserRefund, betA.PayoutAmount);
        Assert.Equal(SettlementAssertions.RoundMoney(scenario.UserA.InitialBalance - scenario.StakeA + expectedLoserRefund), claimA.SystemBalance);
        Assert.Equal(expectedLoserRefund, SettlementAssertions.FindLastLedger(ledgerA, "CLAIM").Amount);
    }

    [ProductionIntegrationFact]
    public async Task Aposta_Com_Resultado_1x0_Sem_Contraparte_Deve_Manter_Saldo_Coerente()
    {
        using var api = new CriptoVersusApiClient(_settings);
        var factory = new TestDataFactory(api, _settings);
        var scenario = await factory.CreateSingleSidedScenarioAsync();

        var walletAfterBet = await api.GetMyWalletAsync(scenario.UserA.Token);
        var settlement = await api.ScoreAndSettleAsync(scenario.Match.MatchId, 1, 0);
        var history = await api.GetWalletHistoryAsync(scenario.UserA.Token, scenario.UserA.UserId, scenario.Match.TeamAId);
        var bet = SettlementAssertions.FindMatch(history, scenario.Match.MatchId);
        var claim = await api.ClaimAsync(scenario.UserA.Token);
        var ledger = await api.GetLedgerAsync(scenario.UserA.Wallet);

        LogScenario("1x0 no counterparty", scenario, settlement, walletAfterBet, null, bet, null, claim, null, ledger, null);

        Assert.Equal("NO_BETS_ON_TEAM_B", settlement.EndReasonCode);
        Assert.Null(bet.IsWinner);
        Assert.Equal(scenario.StakeA, bet.PayoutAmount);
        Assert.Equal(0m, settlement.HouseFeeAmount);
        Assert.Equal(scenario.UserA.InitialBalance, claim.SystemBalance);
    }

    [ProductionIntegrationFact]
    public async Task Aposta_Com_Resultado_0x1_Sem_Contraparte_Deve_Adotar_Regra_Atual_Sem_Explorar_Usuario()
    {
        using var api = new CriptoVersusApiClient(_settings);
        var factory = new TestDataFactory(api, _settings);
        var scenario = await factory.CreateSingleSidedScenarioAsync();

        var walletAfterBet = await api.GetMyWalletAsync(scenario.UserA.Token);
        var settlement = await api.ScoreAndSettleAsync(scenario.Match.MatchId, 0, 1);
        var history = await api.GetWalletHistoryAsync(scenario.UserA.Token, scenario.UserA.UserId, scenario.Match.TeamAId);
        var bet = SettlementAssertions.FindMatch(history, scenario.Match.MatchId);
        var claim = await api.ClaimAsync(scenario.UserA.Token);
        var ledger = await api.GetLedgerAsync(scenario.UserA.Wallet);

        LogScenario("0x1 no counterparty", scenario, settlement, walletAfterBet, null, bet, null, claim, null, ledger, null);

        Assert.Equal("NO_BETS_ON_TEAM_A", settlement.EndReasonCode);
        Assert.Null(bet.IsWinner);
        Assert.Equal(scenario.StakeA, bet.PayoutAmount);
        Assert.Equal(scenario.UserA.InitialBalance, claim.SystemBalance);
    }

    private void LogScenario(
        string scenarioName,
        PreparedScenario scenario,
        InternalTestSettlementResponse settlement,
        MyWalletDto walletAAfterBet,
        MyWalletDto? walletBAfterBet,
        UserMatchHistoryItemDto? betA,
        UserMatchHistoryItemDto? betB,
        WalletActionResultDto? claimA,
        WalletActionResultDto? claimB,
        IReadOnlyList<InternalTestLedgerEntryDto>? ledgerA,
        IReadOnlyList<InternalTestLedgerEntryDto>? ledgerB)
    {
        var lines = new List<string>
        {
            $"Scenario: {scenarioName}",
            $"MatchId: {scenario.Match.MatchId}",
            $"Teams: {scenario.Match.TeamASymbol} vs {scenario.Match.TeamBSymbol}",
            $"InitialBalanceA: {scenario.UserA.InitialBalance}",
            $"InitialBalanceB: {scenario.UserB?.InitialBalance}",
            $"StakeA: {scenario.StakeA}",
            $"StakeB: {scenario.StakeB}",
            $"Score: {settlement.ScoreA}x{settlement.ScoreB}",
            $"PoolA: {settlement.TeamAPool}",
            $"PoolB: {settlement.TeamBPool}",
            $"HouseFee: {settlement.HouseFeeAmount}",
            $"LoserRefundPool: {settlement.LoserRefundPool}",
            $"BalanceAAfterBet: {walletAAfterBet.SystemBalance}",
            $"BalanceBAfterBet: {walletBAfterBet?.SystemBalance}",
            $"PayoutA: {betA?.PayoutAmount}",
            $"PayoutB: {betB?.PayoutAmount}",
            $"ClaimBalanceA: {claimA?.SystemBalance}",
            $"ClaimBalanceB: {claimB?.SystemBalance}",
            $"ReasonCode: {settlement.EndReasonCode}",
            $"LedgerA: {FormatLedger(ledgerA)}",
            $"LedgerB: {FormatLedger(ledgerB)}"
        };

        _output.WriteLine(string.Join(Environment.NewLine, lines));
    }

    private static string FormatLedger(IReadOnlyList<InternalTestLedgerEntryDto>? ledger)
    {
        if (ledger is null || ledger.Count == 0)
            return "[]";

        var compact = ledger.Select(x => $"{x.Type}:{x.Amount} ({x.BalanceBefore}->{x.BalanceAfter})");
        return "[" + string.Join(", ", compact) + "]";
    }
}
