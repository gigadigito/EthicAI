using CriptoVersus.API.Services;
using DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CriptoVersus.API.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/audio-generation/jobs")]
public sealed class AudioGenerationController : ControllerBase
{
    private readonly IAudioGenerationQueueService _queue;
    private readonly IAudioWorkerAuthenticationService _auth;

    public AudioGenerationController(
        IAudioGenerationQueueService queue,
        IAudioWorkerAuthenticationService auth)
    {
        _queue = queue;
        _auth = auth;
    }

    [HttpPost("lease")]
    public async Task<ActionResult<IReadOnlyList<AudioGenerationJobDto>>> Lease(
        [FromBody] AudioGenerationJobLeaseRequest request,
        CancellationToken ct)
    {
        if (!_auth.IsAuthorized(Request))
            return Unauthorized(new { ok = false, reason = "invalid-audio-worker-key" });

        return Ok(await _queue.LeaseJobsAsync(request, ct));
    }

    [HttpPost("{id:long}/complete")]
    [RequestSizeLimit(100_000_000)]
    public async Task<IActionResult> Complete(
        long id,
        [FromForm] AudioGenerationCompleteForm request,
        CancellationToken ct)
    {
        if (!_auth.IsAuthorized(Request))
            return Unauthorized(new { ok = false, reason = "invalid-audio-worker-key" });

        if (request.AudioFile is null || request.AudioFile.Length == 0)
            return BadRequest("audioFile is required.");

        var asset = await _queue.CompleteJobAsync(id, request.ToRequest(), request.AudioFile, ct);
        return Ok(new
        {
            ok = true,
            assetId = asset.Id,
            audioUrl = asset.AudioUrl,
            relativePath = asset.RelativePath
        });
    }

    [HttpPost("{id:long}/fail")]
    public async Task<IActionResult> Fail(
        long id,
        [FromBody] AudioGenerationFailRequest request,
        CancellationToken ct)
    {
        if (!_auth.IsAuthorized(Request))
            return Unauthorized(new { ok = false, reason = "invalid-audio-worker-key" });

        var updated = await _queue.FailJobAsync(id, request, ct);
        return updated ? Ok(new { ok = true }) : NotFound();
    }

    public sealed class AudioGenerationCompleteForm
    {
        public IFormFile? AudioFile { get; set; }
        public int? DurationMs { get; set; }
        public string? FileHash { get; set; }
        public long? FileSizeBytes { get; set; }
        public string? GenerationModel { get; set; }
        public string? GenerationSource { get; set; }
        public string WorkerId { get; set; } = string.Empty;
        public decimal? QualityScore { get; set; }

        public AudioGenerationCompleteRequest ToRequest()
            => new()
            {
                DurationMs = DurationMs,
                FileHash = FileHash,
                FileSizeBytes = FileSizeBytes,
                GenerationModel = GenerationModel,
                GenerationSource = GenerationSource,
                WorkerId = WorkerId,
                QualityScore = QualityScore
            };
    }
}
