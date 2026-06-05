using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using BLL.Blockchain;
using CriptoVersus.API.Services;
using DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Controllers;

[Authorize]
[ApiController]
[Route("api/audio-assets")]
public sealed class AudioAssetsController : ControllerBase
{
    private readonly IAudioAssetAdminService _adminService;
    private readonly IAudioGenerationQueueService _queueService;
    private readonly IConfiguration _configuration;
    private readonly CriptoVersusBlockchainOptions _blockchainOptions;

    public AudioAssetsController(
        IAudioAssetAdminService adminService,
        IAudioGenerationQueueService queueService,
        IConfiguration configuration,
        IOptions<CriptoVersusBlockchainOptions> blockchainOptions)
    {
        _adminService = adminService;
        _queueService = queueService;
        _configuration = configuration;
        _blockchainOptions = blockchainOptions.Value;
    }

    [HttpGet]
    public async Task<ActionResult<AudioAssetAdminListResponseDto>> GetAssets(
        [FromQuery] AudioAssetAdminQueryDto query,
        CancellationToken ct)
    {
        var wallet = RequireAdminWallet();
        if (wallet is null)
            return Forbid();

        return Ok(await _adminService.GetAssetsAsync(query, ct));
    }

    [HttpGet("{id:long}")]
    public async Task<ActionResult<AudioAssetAdminListItemDto>> GetAsset(long id, CancellationToken ct)
    {
        var wallet = RequireAdminWallet();
        if (wallet is null)
            return Forbid();

        var asset = await _adminService.GetAssetAsync(id, ct);
        return asset is null ? NotFound() : Ok(asset);
    }

    [HttpGet("filesystem")]
    public async Task<ActionResult<AudioAssetFilesystemResponseDto>> GetFilesystem(CancellationToken ct)
    {
        var wallet = RequireAdminWallet();
        if (wallet is null)
            return Forbid();

        return Ok(await _adminService.GetFilesystemAsync(ct));
    }

    [HttpPatch("{id:long}/disable")]
    public async Task<ActionResult<AudioAssetAdminActionResultDto>> Disable(long id, CancellationToken ct)
    {
        var wallet = RequireAdminWallet();
        if (wallet is null)
            return Forbid();

        var result = await _adminService.DisableAsync(id, wallet, ct);
        return result.Success ? Ok(result) : NotFound(result);
    }

    [HttpDelete("{id:long}")]
    public async Task<ActionResult<AudioAssetAdminActionResultDto>> DeleteRecord(long id, CancellationToken ct)
    {
        var wallet = RequireAdminWallet();
        if (wallet is null)
            return Forbid();

        var result = await _adminService.DeleteRecordAsync(id, wallet, ct);
        return result.Success ? Ok(result) : NotFound(result);
    }

    [HttpDelete("{id:long}/file-and-record")]
    public async Task<ActionResult<AudioAssetAdminActionResultDto>> DeleteFileAndRecord(long id, CancellationToken ct)
    {
        var wallet = RequireAdminWallet();
        if (wallet is null)
            return Forbid();

        var result = await _adminService.DeleteFileAndRecordAsync(id, wallet, ct);
        return result.Success ? Ok(result) : NotFound(result);
    }

    [HttpPost("bulk-disable")]
    public async Task<ActionResult<AudioAssetAdminActionResultDto>> BulkDisable(
        [FromBody] AudioAssetBulkActionRequestDto request,
        CancellationToken ct)
    {
        var wallet = RequireAdminWallet();
        if (wallet is null)
            return Forbid();

        return Ok(await _adminService.BulkDisableAsync(request.AssetIds, wallet, ct));
    }

    [HttpPost("bulk-delete-file-and-record")]
    public async Task<ActionResult<AudioAssetAdminActionResultDto>> BulkDeleteFileAndRecord(
        [FromBody] AudioAssetBulkActionRequestDto request,
        CancellationToken ct)
    {
        var wallet = RequireAdminWallet();
        if (wallet is null)
            return Forbid();

        return Ok(await _adminService.BulkDeleteFileAndRecordAsync(request.AssetIds, wallet, ct));
    }

    [HttpPost("maintenance/disable-suspect")]
    public async Task<ActionResult<AudioAssetMaintenanceDisableSuspectResponseDto>> DisableSuspect(
        [FromBody] AudioAssetMaintenanceDisableSuspectRequestDto request,
        CancellationToken ct)
    {
        var wallet = RequireAdminWallet();
        if (wallet is null)
            return Forbid();

        return Ok(await _adminService.DisableSuspectsAsync(request, wallet, ct));
    }

    [HttpPost("test-generate")]
    public async Task<ActionResult<AudioAssetTestGenerateResponseDto>> TestGenerate(
        [FromBody] AudioAssetTestGenerateRequestDto request,
        CancellationToken ct)
    {
        var wallet = RequireAdminWallet();
        if (wallet is null)
            return Forbid();

        return Ok(await _queueService.EnqueueManualTestAsync(request, ct));
    }

    [HttpGet("test-status/{jobId:long}")]
    public async Task<ActionResult<AudioAssetTestStatusResponseDto>> TestStatus(long jobId, CancellationToken ct)
    {
        var wallet = RequireAdminWallet();
        if (wallet is null)
            return Forbid();

        var status = await _queueService.GetJobStatusAsync(jobId, ct);
        return status is null ? NotFound() : Ok(status);
    }

    private string? RequireAdminWallet()
    {
        var wallet = User.FindFirstValue("wallet")
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub);

        if (string.IsNullOrWhiteSpace(wallet))
            return null;

        var adminWallet = _configuration["CriptoVersus:AdminWallet"];
        var authorityWallet = _blockchainOptions.GetActiveAuthorityPublicKey();

        return string.Equals(wallet, adminWallet, StringComparison.Ordinal)
            || string.Equals(wallet, authorityWallet, StringComparison.Ordinal)
            ? wallet
            : null;
    }
}
