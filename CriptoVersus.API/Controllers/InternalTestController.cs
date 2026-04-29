using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using BLL.GameRules;
using CriptoVersus.API.Services;
using DAL;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace CriptoVersus.API.Controllers;

[AllowAnonymous]
[ApiController]
[Route("api/internal-test")]
public sealed class InternalTestController : ControllerBase
{
    private const string DefaultWalletPrefix = "test-wallet-";

    private readonly EthicAIDbContext _context;
    private readonly IConfiguration _configuration;
    private readonly ILogger<InternalTestController> _logger;

    public InternalTestController(
        EthicAIDbContext context,
        IConfiguration configuration,
        ILogger<InternalTestController> logger)
    {
        _context = context;
        _configuration = configuration;
        _logger = logger;
    }

    [HttpPost("session")]
    public async Task<ActionResult<InternalTestSessionResponse>> CreateSession(
        [FromBody] InternalTestSessionRequest request,
        CancellationToken ct)
    {
        if (!TryAuthorize(out var error))
            return error;

        if (request is null || string.IsNullOrWhiteSpace(request.Wallet))
            return BadRequest(new { message = "Wallet de teste obrigatoria." });

        if (!IsTestWallet(request.Wallet))
            return BadRequest(new { message = $"A wallet deve iniciar com o prefixo '{GetWalletPrefix()}'." });

        var wallet = request.Wallet.Trim();
        var nowUtc = DateTime.UtcNow;
        var user = await _context.User.FirstOrDefaultAsync(x => x.Wallet == wallet, ct);

        if (user is null)
        {
            user = new User
            {
                Wallet = wallet,
                Name = request.Name ?? "Integration Test User",
                Email = request.Email,
                Balance = 0m,
                DtCreate = nowUtc,
                DtUpdate = nowUtc,
                LastLogin = nowUtc
            };

            _context.User.Add(user);
            await _context.SaveChangesAsync(ct);
        }
        else
        {
            user.Name = request.Name ?? user.Name;
            user.Email = request.Email ?? user.Email;
            user.LastLogin = nowUtc;
            user.DtUpdate = nowUtc;
        }

        if (request.InitialBalance.HasValue)
        {
            var newBalance = RoundMoney(request.InitialBalance.Value);
            var delta = RoundMoney(newBalance - user.Balance);
            if (delta != 0m)
            {
                var balanceBefore = user.Balance;
                user.Balance = newBalance;
                user.DtUpdate = nowUtc;

                _context.Ledger.Add(new Ledger
                {
                    UserId = user.UserID,
                    Type = "TEST_ADJUST",
                    Amount = delta,
                    BalanceBefore = balanceBefore,
                    BalanceAfter = newBalance,
                    CreatedAt = nowUtc,
                    Description = "Ajuste interno de saldo para testes de integracao."
                });
            }
        }

        await _context.SaveChangesAsync(ct);

        var token = GenerateJwtToken(user.Wallet, user.UserID, authType: "test");
        return Ok(new InternalTestSessionResponse
        {
            Token = token,
            Wallet = user.Wallet,
            UserId = user.UserID,
            SystemBalance = user.Balance,
            ExpiresInMinutes = GetJwtExpirationMinutes()
        });
    }

    [HttpGet("teams")]
    public async Task<ActionResult<IReadOnlyList<InternalTestTeamDto>>> GetTeams(CancellationToken ct)
    {
        if (!TryAuthorize(out var error))
            return error;

        var teams = await _context.Team
            .AsNoTracking()
            .Include(t => t.Currency)
            .OrderBy(t => t.TeamId)
            .ToListAsync(ct);

        var items = teams
            .Where(t => t.Currency != null)
            .Where(t => !MatchPairRules.IsForbiddenPair(t.Currency!.Symbol, "BTC", _configuration))
            .Select(t => new InternalTestTeamDto
            {
                TeamId = t.TeamId,
                Symbol = t.Currency!.Symbol,
                Name = t.Currency.Name ?? t.Currency.Symbol
            })
            .ToList();

        return Ok(items);
    }

    [HttpPost("matches")]
    public async Task<ActionResult<InternalTestMatchResponse>> CreateMatch(
        [FromBody] InternalTestCreateMatchRequest request,
        CancellationToken ct)
    {
        if (!TryAuthorize(out var error))
            return error;

        var teams = await ResolveTeamsAsync(request, ct);
        if (teams is null)
            return BadRequest(new { message = "Nao foi possivel resolver um par de times valido para o teste." });

        var match = new Match
        {
            TeamAId = teams.Value.TeamA.TeamId,
            TeamBId = teams.Value.TeamB.TeamId,
            Status = request.StartImmediately ? MatchStatus.Ongoing : MatchStatus.Pending,
            StartTime = request.StartImmediately
                ? DateTime.UtcNow
                : request.StartTimeUtc?.UtcDateTime ?? DateTime.UtcNow.AddMinutes(10),
            BettingCloseTime = DateTimeOffset.UtcNow.AddHours(1),
            EndTime = null,
            ScoreA = 0,
            ScoreB = 0,
            ScoringRuleType = request.ScoringRuleType
        };

        _context.Match.Add(match);
        await _context.SaveChangesAsync(ct);

        _context.MatchScoreState.Add(new MatchScoreState
        {
            MatchId = match.MatchId,
            CreatedAtUtc = DateTime.UtcNow,
            UpdatedAtUtc = DateTime.UtcNow
        });

        await _context.SaveChangesAsync(ct);

        return Ok(new InternalTestMatchResponse
        {
            MatchId = match.MatchId,
            TeamAId = match.TeamAId,
            TeamBId = match.TeamBId,
            TeamASymbol = teams.Value.TeamA.Currency!.Symbol,
            TeamBSymbol = teams.Value.TeamB.Currency!.Symbol,
            Status = match.Status.ToString()
        });
    }

    [HttpPost("matches/{matchId:int}/score-and-settle")]
    public async Task<ActionResult<InternalTestSettlementResponse>> ScoreAndSettle(
        int matchId,
        [FromBody] InternalTestScoreAndSettleRequest request,
        CancellationToken ct)
    {
        if (!TryAuthorize(out var error))
            return error;

        var match = await _context.Match.FirstOrDefaultAsync(x => x.MatchId == matchId, ct);
        if (match is null)
            return NotFound(new { message = $"Partida {matchId} nao encontrada." });

        match.ScoreA = request.ScoreA;
        match.ScoreB = request.ScoreB;
        match.Status = MatchStatus.Completed;
        match.EndTime = DateTime.UtcNow;
        match.WinnerTeamId = GetEffectiveWinnerTeamId(match);
        match.RulesetVersion ??= RuleConstants.DefaultRulesetVersion;

        await ApplySettlementAsync(match, ct);
        await _context.SaveChangesAsync(ct);

        var teamAPool = await _context.Bet
            .AsNoTracking()
            .Where(x => x.MatchId == matchId && x.TeamId == match.TeamAId)
            .SumAsync(x => (decimal?)x.Amount, ct) ?? 0m;

        var teamBPool = await _context.Bet
            .AsNoTracking()
            .Where(x => x.MatchId == matchId && x.TeamId == match.TeamBId)
            .SumAsync(x => (decimal?)x.Amount, ct) ?? 0m;

        var losingPool = match.WinnerTeamId == match.TeamAId ? teamBPool : match.WinnerTeamId == match.TeamBId ? teamAPool : 0m;
        var houseFeeRate = ClampRate(GetDecimal("CriptoVersusWorker:Settlement:HouseFeeRate", 0.01m));
        var loserRefundRate = ClampRate(GetDecimal("CriptoVersusWorker:Settlement:LoserRefundRate", 0.94m), 1m - houseFeeRate);
        var houseFeeAmount = HasCounterparty(teamAPool, teamBPool, request.ScoreA, request.ScoreB)
            ? RoundMoney(losingPool * houseFeeRate)
            : 0m;
        var loserRefundPool = HasCounterparty(teamAPool, teamBPool, request.ScoreA, request.ScoreB)
            ? RoundMoney(losingPool * loserRefundRate)
            : 0m;

        return Ok(new InternalTestSettlementResponse
        {
            MatchId = match.MatchId,
            ScoreA = match.ScoreA,
            ScoreB = match.ScoreB,
            WinnerTeamId = match.WinnerTeamId,
            EndReasonCode = match.EndReasonCode,
            EndReasonDetail = match.EndReasonDetail,
            TeamAPool = teamAPool,
            TeamBPool = teamBPool,
            HouseFeeAmount = houseFeeAmount,
            LoserRefundPool = loserRefundPool
        });
    }

    [HttpGet("users/{wallet}/ledger")]
    public async Task<ActionResult<IReadOnlyList<InternalTestLedgerEntryDto>>> GetLedger(
        string wallet,
        CancellationToken ct)
    {
        if (!TryAuthorize(out var error))
            return error;

        if (!IsTestWallet(wallet))
            return BadRequest(new { message = "Wallet invalida para leitura de ledger de teste." });

        var user = await _context.User.AsNoTracking().FirstOrDefaultAsync(x => x.Wallet == wallet, ct);
        if (user is null)
            return NotFound(new { message = "Usuario de teste nao encontrado." });

        var items = await _context.Ledger
            .AsNoTracking()
            .Where(x => x.UserId == user.UserID)
            .OrderBy(x => x.Id)
            .Select(x => new InternalTestLedgerEntryDto
            {
                Id = x.Id,
                Type = x.Type,
                Amount = x.Amount,
                BalanceBefore = x.BalanceBefore,
                BalanceAfter = x.BalanceAfter,
                ReferenceId = x.ReferenceId,
                Description = x.Description,
                CreatedAt = x.CreatedAt
            })
            .ToListAsync(ct);

        return Ok(items);
    }

    private async Task ApplySettlementAsync(Match match, CancellationToken ct)
    {
        var bets = await _context.Bet
            .Where(b => b.MatchId == match.MatchId && b.SettledAt == null)
            .ToListAsync(ct);

        if (bets.Count == 0)
            return;

        var winnerTeamId = GetEffectiveWinnerTeamId(match);
        var loserTeamId = winnerTeamId.HasValue
            ? (winnerTeamId == match.TeamAId ? match.TeamBId : match.TeamAId)
            : (int?)null;

        if (winnerTeamId is not int settledWinnerTeamId || loserTeamId is not int settledLoserTeamId)
        {
            ApplyNoContestReason(match, match.ScoreA == 0 && match.ScoreB == 0 ? "DRAW_ZERO_ZERO" : "NO_WINNER");
            await SettleNoContestAsync(bets, ct);
            return;
        }

        var winnerBets = bets.Where(b => b.TeamId == settledWinnerTeamId).ToList();
        var loserBets = bets.Where(b => b.TeamId == settledLoserTeamId).ToList();
        var totalWinnerStake = winnerBets.Sum(b => SafeMoney(b.Amount));
        var totalLoserStake = loserBets.Sum(b => SafeMoney(b.Amount));

        if (winnerBets.Count == 0 || loserBets.Count == 0 || totalWinnerStake <= 0m || totalLoserStake <= 0m)
        {
            ApplyNoContestReason(match, DetermineNoContestReason(match, winnerBets.Count, loserBets.Count, totalWinnerStake, totalLoserStake));
            await SettleNoContestAsync(bets, ct);
            return;
        }

        var houseFeeRate = ClampRate(GetDecimal("CriptoVersusWorker:Settlement:HouseFeeRate", 0.01m));
        var loserRefundRate = ClampRate(GetDecimal("CriptoVersusWorker:Settlement:LoserRefundRate", 0.94m), 1m - houseFeeRate);
        var platformFee = RoundMoney(totalLoserStake * houseFeeRate);
        var loserRefundPool = RoundMoney(totalLoserStake * loserRefundRate);
        var distributablePool = RoundMoney(totalLoserStake - platformFee - loserRefundPool);
        var settledAtUtc = DateTime.UtcNow;

        foreach (var bet in loserBets)
        {
            bet.IsWinner = false;
            var loserStake = SafeMoney(bet.Amount);
            bet.PayoutAmount = totalLoserStake == 0m
                ? 0m
                : RoundMoney((loserStake / totalLoserStake) * loserRefundPool);
            bet.SettledAt = settledAtUtc;
            bet.Claimed = false;
            bet.ClaimedAt = null;

            await ApplyPositionCapitalAsync(bet, bet.PayoutAmount ?? 0m, settledAtUtc, ct);
        }

        foreach (var bet in winnerBets)
        {
            var stake = SafeMoney(bet.Amount);
            var share = totalWinnerStake == 0m ? 0m : (stake / totalWinnerStake);
            var profit = RoundMoney(share * distributablePool);

            bet.IsWinner = true;
            bet.PayoutAmount = RoundMoney(stake + profit);
            bet.SettledAt = settledAtUtc;
            bet.Claimed = false;
            bet.ClaimedAt = null;

            await ApplyPositionCapitalAsync(bet, bet.PayoutAmount ?? 0m, settledAtUtc, ct);
        }
    }

    private async Task SettleNoContestAsync(IReadOnlyCollection<Bet> bets, CancellationToken ct)
    {
        var settledAtUtc = DateTime.UtcNow;

        foreach (var bet in bets)
        {
            var principal = SafeMoney(bet.Amount);
            bet.IsWinner = null;
            bet.PayoutAmount = principal;
            bet.SettledAt = settledAtUtc;
            bet.Claimed = false;
            bet.ClaimedAt = null;

            await ApplyPositionCapitalAsync(bet, principal, settledAtUtc, ct);
        }
    }

    private async Task ApplyPositionCapitalAsync(Bet bet, decimal capital, DateTime settledAtUtc, CancellationToken ct)
    {
        if (!bet.PositionId.HasValue)
            return;

        var position = await _context.UserTeamPosition.FirstOrDefaultAsync(p => p.PositionId == bet.PositionId.Value, ct);
        if (position is null)
            return;

        position.CurrentCapital = RoundMoney(capital);
        position.UpdatedAt = settledAtUtc;

        var minPositionCapital = Math.Max(GetDecimal("CriptoVersusWorker:Settlement:MinPositionCapital", 0.00000001m), 0m);
        if (position.Status == TeamPositionStatus.ClosingRequested)
        {
            position.Status = TeamPositionStatus.Closed;
            position.AutoCompound = false;
            position.ClosedAt = settledAtUtc;
        }
        else if (position.CurrentCapital <= minPositionCapital)
        {
            position.Status = TeamPositionStatus.Paused;
            position.AutoCompound = false;
        }
        else
        {
            position.Status = TeamPositionStatus.Active;
        }
    }

    private async Task<(Team TeamA, Team TeamB)?> ResolveTeamsAsync(InternalTestCreateMatchRequest request, CancellationToken ct)
    {
        var teams = await _context.Team
            .AsNoTracking()
            .Include(t => t.Currency)
            .OrderBy(t => t.TeamId)
            .ToListAsync(ct);

        if (request.TeamAId.HasValue && request.TeamBId.HasValue)
        {
            var teamAById = teams.FirstOrDefault(t => t.TeamId == request.TeamAId.Value);
            var teamBById = teams.FirstOrDefault(t => t.TeamId == request.TeamBId.Value);
            if (teamAById is null || teamBById is null || teamAById.TeamId == teamBById.TeamId)
                return null;

            return (teamAById, teamBById);
        }

        if (!string.IsNullOrWhiteSpace(request.TeamASymbol) && !string.IsNullOrWhiteSpace(request.TeamBSymbol))
        {
            var teamABySymbol = teams.FirstOrDefault(t => string.Equals(t.Currency?.Symbol, request.TeamASymbol, StringComparison.OrdinalIgnoreCase));
            var teamBBySymbol = teams.FirstOrDefault(t => string.Equals(t.Currency?.Symbol, request.TeamBSymbol, StringComparison.OrdinalIgnoreCase));
            if (teamABySymbol is null || teamBBySymbol is null || teamABySymbol.TeamId == teamBBySymbol.TeamId)
                return null;

            return (teamABySymbol, teamBBySymbol);
        }

        for (var i = 0; i < teams.Count; i++)
        {
            for (var j = i + 1; j < teams.Count; j++)
            {
                var teamA = teams[i];
                var teamB = teams[j];
                if (teamA.Currency is null || teamB.Currency is null)
                    continue;

                if (MatchPairRules.IsForbiddenPair(teamA.Currency.Symbol, teamB.Currency.Symbol, _configuration))
                    continue;

                return (teamA, teamB);
            }
        }

        return null;
    }

    private bool TryAuthorize(out ActionResult error)
    {
        if (!_configuration.GetValue<bool>("CriptoVersusTestSupport:Enabled"))
        {
            error = NotFound();
            return false;
        }

        var expectedKey = _configuration["CriptoVersusTestSupport:ApiKey"];
        if (string.IsNullOrWhiteSpace(expectedKey))
        {
            error = StatusCode(StatusCodes.Status500InternalServerError, new { message = "CriptoVersusTestSupport:ApiKey nao configurada." });
            return false;
        }

        if (!Request.Headers.TryGetValue("X-Test-Key", out var providedKey) ||
            !string.Equals(providedKey.ToString(), expectedKey, StringComparison.Ordinal))
        {
            error = Unauthorized(new { message = "Chave de teste invalida." });
            return false;
        }

        error = Ok();
        return true;
    }

    private string GenerateJwtToken(string publicKey, int userId, string authType)
    {
        var jwtKey = _configuration["Jwt:Key"];
        var jwtIssuer = _configuration["Jwt:Issuer"];
        var jwtAudience = _configuration["Jwt:Audience"];

        if (string.IsNullOrWhiteSpace(jwtKey))
            throw new InvalidOperationException("Jwt:Key nao configurado.");

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, publicKey),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new(ClaimTypes.NameIdentifier, publicKey),
            new("cd_user", userId.ToString()),
            new("wallet", publicKey),
            new("auth_type", authType)
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var expiresMinutes = GetJwtExpirationMinutes();

        var token = new JwtSecurityToken(
            issuer: jwtIssuer,
            audience: jwtAudience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(expiresMinutes),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private int GetJwtExpirationMinutes()
    {
        var configured = _configuration["Jwt:ExpiresMinutes"];
        return int.TryParse(configured, out var minutes) && minutes > 0 ? minutes : 120;
    }

    private string GetWalletPrefix()
        => _configuration["CriptoVersusTestSupport:WalletPrefix"] ?? DefaultWalletPrefix;

    private bool IsTestWallet(string wallet)
        => wallet.Trim().StartsWith(GetWalletPrefix(), StringComparison.OrdinalIgnoreCase);

    private decimal GetDecimal(string key, decimal fallback)
        => decimal.TryParse(_configuration[key], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var value)
            ? value
            : fallback;

    private static decimal SafeMoney(decimal value)
        => value < 0m ? 0m : RoundMoney(value);

    private static decimal RoundMoney(decimal value)
        => Math.Round(value, 8, MidpointRounding.ToZero);

    private static decimal ClampRate(decimal rate, decimal max = 1m)
        => Math.Clamp(rate, 0m, max);

    private static int? GetEffectiveWinnerTeamId(Match match)
    {
        if (match.WinnerTeamId.HasValue)
            return match.WinnerTeamId;

        if (match.ScoreA > match.ScoreB)
            return match.TeamAId;

        if (match.ScoreB > match.ScoreA)
            return match.TeamBId;

        return null;
    }

    private static bool HasCounterparty(decimal teamAPool, decimal teamBPool, int scoreA, int scoreB)
        => scoreA != scoreB && teamAPool > 0m && teamBPool > 0m;

    private static string DetermineNoContestReason(
        Match match,
        int winnerBetsCount,
        int loserBetsCount,
        decimal totalWinnerStake,
        decimal totalLoserStake)
    {
        var effectiveWinnerTeamId = GetEffectiveWinnerTeamId(match);

        if (match.ScoreA == 0 && match.ScoreB == 0)
            return "DRAW_ZERO_ZERO";

        if (!effectiveWinnerTeamId.HasValue || match.ScoreA == match.ScoreB)
            return "NO_WINNER";

        if (effectiveWinnerTeamId == match.TeamAId && (winnerBetsCount <= 0 || totalWinnerStake <= 0m))
            return "NO_BETS_ON_TEAM_A";

        if (effectiveWinnerTeamId == match.TeamBId && (winnerBetsCount <= 0 || totalWinnerStake <= 0m))
            return "NO_BETS_ON_TEAM_B";

        if (effectiveWinnerTeamId == match.TeamAId && (loserBetsCount <= 0 || totalLoserStake <= 0m))
            return "NO_BETS_ON_TEAM_B";

        if (effectiveWinnerTeamId == match.TeamBId && (loserBetsCount <= 0 || totalLoserStake <= 0m))
            return "NO_BETS_ON_TEAM_A";

        return "NO_COUNTERPARTY";
    }

    private static void ApplyNoContestReason(Match match, string reasonCode)
    {
        match.EndReasonCode = reasonCode;
        match.EndReasonDetail = reasonCode switch
        {
            "DRAW_ZERO_ZERO" => "Placar final 0x0. Nao houve vencedor nem disputa financeira valida.",
            "NO_BETS_ON_TEAM_A" => $"Nao havia apostas validas em {match.TeamAId}. Sem contraparte financeira valida.",
            "NO_BETS_ON_TEAM_B" => $"Nao havia apostas validas em {match.TeamBId}. Sem contraparte financeira valida.",
            "NO_COUNTERPARTY" => "Nao havia apostas validas nos dois lados para formar contraparte financeira.",
            _ => "Partida encerrada sem vencedor definido. Apostas devolvidas integralmente."
        };
        match.RulesetVersion ??= RuleConstants.DefaultRulesetVersion;
    }
}

public sealed class InternalTestSessionRequest
{
    public string Wallet { get; set; } = string.Empty;
    public string? Name { get; set; }
    public string? Email { get; set; }
    public decimal? InitialBalance { get; set; }
}

public sealed class InternalTestSessionResponse
{
    public string Token { get; set; } = string.Empty;
    public string Wallet { get; set; } = string.Empty;
    public int UserId { get; set; }
    public decimal SystemBalance { get; set; }
    public int ExpiresInMinutes { get; set; }
}

public sealed class InternalTestTeamDto
{
    public int TeamId { get; set; }
    public string Symbol { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
}

public sealed class InternalTestCreateMatchRequest
{
    public int? TeamAId { get; set; }
    public int? TeamBId { get; set; }
    public string? TeamASymbol { get; set; }
    public string? TeamBSymbol { get; set; }
    public bool StartImmediately { get; set; } = true;
    public DateTimeOffset? StartTimeUtc { get; set; }
    public MatchScoringRuleType ScoringRuleType { get; set; } = MatchScoringRuleType.PercentThreshold;
}

public sealed class InternalTestMatchResponse
{
    public int MatchId { get; set; }
    public int TeamAId { get; set; }
    public int TeamBId { get; set; }
    public string TeamASymbol { get; set; } = string.Empty;
    public string TeamBSymbol { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
}

public sealed class InternalTestScoreAndSettleRequest
{
    public int ScoreA { get; set; }
    public int ScoreB { get; set; }
}

public sealed class InternalTestSettlementResponse
{
    public int MatchId { get; set; }
    public int ScoreA { get; set; }
    public int ScoreB { get; set; }
    public int? WinnerTeamId { get; set; }
    public string? EndReasonCode { get; set; }
    public string? EndReasonDetail { get; set; }
    public decimal TeamAPool { get; set; }
    public decimal TeamBPool { get; set; }
    public decimal HouseFeeAmount { get; set; }
    public decimal LoserRefundPool { get; set; }
}

public sealed class InternalTestLedgerEntryDto
{
    public int Id { get; set; }
    public string Type { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public decimal BalanceBefore { get; set; }
    public decimal BalanceAfter { get; set; }
    public int? ReferenceId { get; set; }
    public string? Description { get; set; }
    public DateTime CreatedAt { get; set; }
}
