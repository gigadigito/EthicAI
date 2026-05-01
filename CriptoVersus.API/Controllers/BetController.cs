using BLL;
using BLL.Blockchain;
using BLL.NFTFutebol;
using CriptoVersus.API.Services;
using CriptoVersus.API.Hubs;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;

namespace CriptoVersus.API.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/match")]
    public class BetController : ControllerBase
    {
        private readonly EthicAIDbContext _context;
        private readonly ILogger<BetController> _logger;
        private readonly ILedgerService _ledgerService;
        private readonly IHubContext<DashboardHub> _hub;
        private readonly IConfiguration _configuration;
        private readonly ICriptoVersusFundsService _fundsService;
        private readonly CriptoVersusBlockchainOptions _blockchainOptions;
        private readonly IOffChainCustodyTransferVerifier _offChainCustodyTransferVerifier;

        private const int LiveBetMaxMinutes = 45;

        public BetController(
            EthicAIDbContext context,
            ILogger<BetController> logger,
            ILedgerService ledgerService,
            IHubContext<DashboardHub> hub,
            IConfiguration configuration,
            ICriptoVersusFundsService fundsService,
            IOffChainCustodyTransferVerifier offChainCustodyTransferVerifier,
            IOptions<CriptoVersusBlockchainOptions> blockchainOptions)
        {
            _context = context;
            _logger = logger;
            _ledgerService = ledgerService;
            _hub = hub;
            _configuration = configuration;
            _fundsService = fundsService;
            _offChainCustodyTransferVerifier = offChainCustodyTransferVerifier;
            _blockchainOptions = blockchainOptions.Value;
        }

        [HttpPost("{matchId:int}/bet")]
        public async Task<IActionResult> CreateBet(
            int matchId,
            [FromBody] BetCreateRequest request,
            CancellationToken cancellationToken)
        {
            if (request == null)
                return BadRequest("Requisição inválida.");

            var wallet = GetAuthenticatedWallet();
            if (string.IsNullOrWhiteSpace(wallet))
                return Unauthorized(new { message = "Token sem wallet válida." });

            if (request.TeamId <= 0)
                return BadRequest("TeamId inválido.");

            if (request.Amount <= 0)
                return BadRequest("O valor do investimento deve ser maior que zero.");

            request.Amount = decimal.Round(request.Amount, 8, MidpointRounding.ToZero);

            if (request.Amount <= 0)
                return BadRequest("O valor do investimento ficou inválido após o arredondamento.");

            var onChainBettingEnabled = _blockchainOptions.IsOnChainDepositFlowEnabled();
            var fundedFromWallet = !string.IsNullOrWhiteSpace(request.OnChainSignature);
            var isInternalTestAuth = IsInternalTestAuth(wallet);

            if (onChainBettingEnabled
                && _blockchainOptions.RequireOnChainConfirmation
                && string.IsNullOrWhiteSpace(request.OnChainSignature)
                && !_blockchainOptions.AllowFallbackToOffChain
                && !isInternalTestAuth)
            {
                return BadRequest(new
                {
                    message = "A assinatura da transação Solana é obrigatória para investimentos on-chain."
                });
            }

            var strategy = _context.Database.CreateExecutionStrategy();

            BetCreateResponse? response = null;

            try
            {
                await strategy.ExecuteAsync(async () =>
                {
                    await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);

                    var match = await _context.Match
                        .Include(m => m.TeamA)
                        .Include(m => m.TeamB)
                        .FirstOrDefaultAsync(m => m.MatchId == matchId, cancellationToken);

                    if (match == null)
                        throw new BetHttpException(StatusCodes.Status404NotFound, $"Partida {matchId} não encontrada.");

                    var authenticatedUser = await _context.User
                        .FirstOrDefaultAsync(u => u.Wallet == wallet, cancellationToken);

                    if (authenticatedUser == null)
                        throw new BetHttpException(StatusCodes.Status404NotFound, "Usuário autenticado não encontrado.");

                    var isAdminWallet = IsAdminWallet(wallet);
                    var targetUserId = request.UserId > 0 ? request.UserId : authenticatedUser.UserID;

                    if (!isAdminWallet && targetUserId != authenticatedUser.UserID)
                    {
                        throw new BetHttpPayloadException(StatusCodes.Status403Forbidden, new
                        {
                            message = "O UserId informado não pertence ao usuário autenticado."
                        });
                    }

                    var user = targetUserId == authenticatedUser.UserID
                        ? authenticatedUser
                        : await _context.User.FirstOrDefaultAsync(u => u.UserID == targetUserId, cancellationToken);

                    if (user == null)
                        throw new BetHttpException(StatusCodes.Status404NotFound, $"Usuário {targetUserId} não encontrado.");

                    if (!IsValidMatchTeam(match, request.TeamId))
                        throw new BetHttpException(StatusCodes.Status400BadRequest, "O TeamId informado não pertence a esta partida.");

                    var elapsedMinutes = GetElapsedMinutes(match);

                    if (!IsBettingWindowOpen(match, elapsedMinutes))
                    {
                        throw new BetHttpPayloadException(StatusCodes.Status400BadRequest, new
                        {
                            message = "A janela de investimentos desta partida está fechada.",
                            bettingCloseTime = match.BettingCloseTime,
                            matchStartTime = match.StartTime,
                            matchStatus = match.Status.ToString(),
                            elapsedMinutes,
                            liveBetMaxMinutes = LiveBetMaxMinutes
                        });
                    }

                    if (!fundedFromWallet && user.Balance < request.Amount)
                    {
                        throw new BetHttpPayloadException(StatusCodes.Status400BadRequest, new
                        {
                            message = "Saldo insuficiente para realizar o investimento.",
                            currentBalance = user.Balance,
                            requestedAmount = request.Amount
                        });
                    }

                    if (fundedFromWallet && _blockchainOptions.IsOffChainCustodyMode)
                    {
                        if (string.IsNullOrWhiteSpace(_blockchainOptions.CustodyWalletPublicKey))
                        {
                            throw new BetHttpPayloadException(StatusCodes.Status400BadRequest, new
                            {
                                message = "Carteira de custodia off-chain nao configurada."
                            });
                        }

                        var expectedLamports = ParseRequiredLamports(request.OnChainAmountLamports);
                        var verification = await _offChainCustodyTransferVerifier.VerifyAsync(
                            request.OnChainSignature!,
                            wallet,
                            _blockchainOptions.CustodyWalletPublicKey,
                            expectedLamports,
                            cancellationToken);

                        if (!verification.Succeeded)
                        {
                            throw new BetHttpPayloadException(StatusCodes.Status400BadRequest, new
                            {
                                message = verification.Message,
                                code = "OFFCHAIN_CUSTODY_TRANSFER_INVALID"
                            });
                        }
                    }

                    var nowUtc = DateTime.UtcNow;
                    var balanceBefore = user.Balance;

                    if (!fundedFromWallet)
                    {
                        var lockResult = await _fundsService.LockBetAmountAsync(wallet, matchId, request.TeamId, request.Amount);
                        if (!lockResult.Succeeded)
                        {
                            throw new BetHttpPayloadException(StatusCodes.Status400BadRequest, new
                            {
                                message = lockResult.Message,
                                code = lockResult.Code
                            });
                        }
                    }

                    var position = await _context.UserTeamPosition
                        .FirstOrDefaultAsync(p => p.UserId == user.UserID && p.TeamId == request.TeamId, cancellationToken);

                    if (position is null)
                    {
                        position = new DAL.NftFutebol.UserTeamPosition
                        {
                            UserId = user.UserID,
                            TeamId = request.TeamId,
                            PrincipalAllocated = request.Amount,
                            CurrentCapital = request.Amount,
                            AutoCompound = true,
                            Status = TeamPositionStatus.Active,
                            OnChainPositionAddress = NormalizeAddress(request.OnChainPositionAccount),
                            OnChainVaultAddress = NormalizeAddress(request.OnChainPositionVault),
                            LastOnChainSignature = NormalizeAddress(request.OnChainSignature),
                            OnChainCluster = fundedFromWallet
                                ? _blockchainOptions.Cluster
                                : null,
                            CurrentLamports = ParseLamports(request.OnChainAmountLamports),
                            CreatedAt = nowUtc,
                            UpdatedAt = nowUtc
                        };

                        _context.UserTeamPosition.Add(position);
                    }
                    else
                    {
                        position.PrincipalAllocated = RoundMoney(position.PrincipalAllocated + request.Amount);
                        position.CurrentCapital = RoundMoney(position.CurrentCapital + request.Amount);
                        position.Status = TeamPositionStatus.Active;
                        position.AutoCompound = true;
                        position.ClosedAt = null;
                        position.OnChainPositionAddress = NormalizeAddress(request.OnChainPositionAccount) ?? position.OnChainPositionAddress;
                        position.OnChainVaultAddress = NormalizeAddress(request.OnChainPositionVault) ?? position.OnChainVaultAddress;
                        position.LastOnChainSignature = NormalizeAddress(request.OnChainSignature) ?? position.LastOnChainSignature;
                        position.OnChainCluster = fundedFromWallet
                            ? _blockchainOptions.Cluster
                            : position.OnChainCluster;
                        position.CurrentLamports = AddLamports(
                            position.CurrentLamports,
                            ParseLamports(request.OnChainAmountLamports));
                        position.UpdatedAt = nowUtc;
                    }

                    await _context.SaveChangesAsync(cancellationToken);

                    var bet = await _context.Bet
                        .FirstOrDefaultAsync(b =>
                            b.MatchId == matchId &&
                            b.PositionId == position.PositionId &&
                            b.SettledAt == null,
                            cancellationToken);

                    if (bet is null)
                    {
                        var nextPosition = (await _context.Bet
                            .Where(b => b.MatchId == matchId)
                            .Select(b => (int?)b.Position)
                            .MaxAsync(cancellationToken) ?? 0) + 1;

                        bet = new DAL.NftFutebol.Bet
                        {
                            MatchId = matchId,
                            TeamId = request.TeamId,
                            UserId = user.UserID,
                            PositionId = position.PositionId,
                            Amount = request.Amount,
                            BetTime = nowUtc,
                            Position = nextPosition,
                            Claimed = false,
                            ClaimedAt = null,
                            IsWinner = null,
                            PayoutAmount = null,
                            SettledAt = null
                        };

                        _context.Bet.Add(bet);
                    }
                    else
                    {
                        bet.Amount = RoundMoney(bet.Amount + request.Amount);
                    }

                    await _context.SaveChangesAsync(cancellationToken);

                    if (fundedFromWallet)
                    {
                        var ledgerType = _blockchainOptions.IsOffChainCustodyMode
                            ? "BET_OFFCHAIN_CUSTODY"
                            : "BET_ONCHAIN";
                        var ledgerDescription = _blockchainOptions.IsOffChainCustodyMode
                            ? $"Investimento off-chain custodiado no match {bet.MatchId}, team {bet.TeamId}, transfer signature {request.OnChainSignature}"
                            : $"Investimento on-chain realizado no match {bet.MatchId}, team {bet.TeamId}, signature {request.OnChainSignature}";

                        await _ledgerService.AddEntryAsync(
                            user: user,
                            type: ledgerType,
                            amount: 0m,
                            balanceBefore: balanceBefore,
                            balanceAfter: user.Balance,
                            referenceId: bet.BetId,
                            description: ledgerDescription,
                            ct: cancellationToken);
                    }

                    await transaction.CommitAsync(cancellationToken);

                    _logger.LogInformation(
                        "Investimento criado com sucesso. BetId={BetId}, MatchId={MatchId}, UserId={UserId}, TeamId={TeamId}, Amount={Amount}, BalanceBefore={BalanceBefore}, BalanceAfter={BalanceAfter}, MatchStatus={MatchStatus}, ElapsedMinutes={ElapsedMinutes}",
                        bet.BetId,
                        bet.MatchId,
                        bet.UserId,
                        bet.TeamId,
                        bet.Amount,
                        balanceBefore,
                        user.Balance,
                        match.Status,
                        elapsedMinutes);

                    response = new BetCreateResponse
                    {
                        BetId = bet.BetId,
                        MatchId = bet.MatchId,
                        UserId = bet.UserId,
                        TeamId = bet.TeamId,
                        Amount = bet.Amount,
                        UserBalanceAfterBet = user.Balance,
                        BetTime = bet.BetTime,
                        Position = bet.Position,
                        Claimed = bet.Claimed,
                        IsWinner = bet.IsWinner,
                        PayoutAmount = bet.PayoutAmount,
                        SettledAt = bet.SettledAt,
                        BettingCloseTime = match.BettingCloseTime,
                        OnChainSignature = request.OnChainSignature,
                        Message = "Investimento registrado com sucesso."
                    };
                });

                if (response is not null)
                    await NotifyDashboardChangedAsync(response, cancellationToken);

                return Ok(response);
            }
            catch (BetHttpPayloadException ex)
            {
                return StatusCode(ex.StatusCode, ex.Payload);
            }
            catch (BetHttpException ex)
            {
                return StatusCode(ex.StatusCode, ex.Message);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Erro ao criar investimento para MatchId={MatchId}, UserId={UserId}, TeamId={TeamId}, Amount={Amount}",
                    matchId,
                    request?.UserId,
                    request?.TeamId,
                    request?.Amount);

                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    message = "Erro interno ao registrar o investimento.",
                    detail = ex.Message
                });
            }
        }

        private static bool IsValidMatchTeam(DAL.NftFutebol.Match match, int teamId)
        {
            return match.TeamAId == teamId || match.TeamBId == teamId;
        }

        private string? GetAuthenticatedWallet()
        {
            return User.FindFirstValue("wallet")
                ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub);
        }

        private static decimal RoundMoney(decimal value)
            => Math.Round(value, 8, MidpointRounding.ToZero);

        private static string? NormalizeAddress(string? value)
            => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

        private static long? ParseLamports(string? value)
        {
            if (string.IsNullOrWhiteSpace(value))
                return null;

            return long.TryParse(value, out var parsed) && parsed >= 0 ? parsed : null;
        }

        private static long? AddLamports(long? current, long? added)
            => added.HasValue ? (current ?? 0L) + added.Value : current;

        private static long ParseRequiredLamports(string? value)
        {
            if (string.IsNullOrWhiteSpace(value) || !long.TryParse(value, out var parsed) || parsed <= 0)
                throw new BetHttpPayloadException(StatusCodes.Status400BadRequest, new
                {
                    message = "OnChainAmountLamports obrigatorio e invalido para funding via custody off-chain.",
                    code = "OFFCHAIN_CUSTODY_LAMPORTS_REQUIRED"
                });

            return parsed;
        }

        private bool IsAdminWallet(string wallet)
        {
            var adminWallet = _configuration["CriptoVersus:AdminWallet"];
            var onChainAuthorityWallet = _blockchainOptions.GetActiveAuthorityPublicKey();

            return IsConfiguredWallet(wallet, adminWallet)
                || IsConfiguredWallet(wallet, onChainAuthorityWallet);
        }

        private bool IsInternalTestAuth(string wallet)
        {
            if (!_configuration.GetValue<bool>("CriptoVersusTestSupport:Enabled"))
                return false;

            var authType = User.FindFirstValue("auth_type");
            if (!string.Equals(authType, "test", StringComparison.OrdinalIgnoreCase))
                return false;

            var walletPrefix = _configuration["CriptoVersusTestSupport:WalletPrefix"] ?? "test-wallet-";
            return wallet.StartsWith(walletPrefix, StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsConfiguredWallet(string wallet, string? configuredWallet)
        {
            return !string.IsNullOrWhiteSpace(configuredWallet)
                && string.Equals(wallet, configuredWallet, StringComparison.Ordinal);
        }

        private Task NotifyDashboardChangedAsync(BetCreateResponse response, CancellationToken cancellationToken)
        {
            return _hub.Clients.All.SendAsync(
                "dashboard_changed",
                JsonSerializer.Serialize(new
                {
                    reason = "bet_created",
                    response.MatchId,
                    response.BetId,
                    response.UserId,
                    utc = DateTimeOffset.UtcNow
                }),
                cancellationToken);
        }

        private static bool IsBettingWindowOpen(DAL.NftFutebol.Match match, int elapsedMinutes)
        {
            var now = DateTimeOffset.UtcNow;

            if (match.Status == MatchStatus.Pending)
            {
                if (match.BettingCloseTime.HasValue)
                    return now <= match.BettingCloseTime.Value;

                return match.StartTime.HasValue && now < match.StartTime.Value;
            }

            if (match.Status == MatchStatus.Ongoing)
            {
                return elapsedMinutes >= 0 && elapsedMinutes < LiveBetMaxMinutes;
            }

            return false;
        }

        private static int GetElapsedMinutes(DAL.NftFutebol.Match match)
        {
            if (!match.StartTime.HasValue)
                return 0;

            var startUtc = match.StartTime.Value.ToUniversalTime();
            var elapsed = DateTime.UtcNow - startUtc;

            if (elapsed.TotalMinutes < 0)
                return 0;

            return (int)elapsed.TotalMinutes;
        }

        private sealed class BetHttpException : Exception
        {
            public int StatusCode { get; }

            public BetHttpException(int statusCode, string message) : base(message)
            {
                StatusCode = statusCode;
            }
        }

        private sealed class BetHttpPayloadException : Exception
        {
            public int StatusCode { get; }
            public object Payload { get; }

            public BetHttpPayloadException(int statusCode, object payload)
            {
                StatusCode = statusCode;
                Payload = payload;
            }
        }
    }
}
