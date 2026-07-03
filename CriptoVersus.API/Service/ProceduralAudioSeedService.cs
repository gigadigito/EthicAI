using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;

namespace CriptoVersus.API.Services;

public interface IProceduralAudioSeedService
{
    Task EnsureSeedAsync(CancellationToken ct = default);
}

public sealed class ProceduralAudioSeedService : IProceduralAudioSeedService
{
    private static readonly DateTime SeedTimestampUtc = new(2026, 6, 4, 0, 0, 0, DateTimeKind.Utc);

    private readonly EthicAIDbContext _db;
    private readonly ILogger<ProceduralAudioSeedService> _logger;

    public ProceduralAudioSeedService(
        EthicAIDbContext db,
        ILogger<ProceduralAudioSeedService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task EnsureSeedAsync(CancellationToken ct = default)
    {
        await UpsertTemplatesAsync(ct);
        await UpsertVoiceProfilesAsync(ct);
    }

    private async Task UpsertTemplatesAsync(CancellationToken ct)
    {
        var seeds = new[]
        {
            new AudioPhraseTemplate { TemplateKey = "goal_pt_br_hype", EventType = "goal", Language = "pt-BR", Intensity = "hype", TemplateText = "É gol de {TEAM_NAME}! A arena CriptoVersus explode em emoção!", IsActive = true, Priority = 100, CreatedAtUtc = SeedTimestampUtc, UpdatedAtUtc = SeedTimestampUtc },
            new AudioPhraseTemplate { TemplateKey = "goal_en_us_hype", EventType = "goal", Language = "en-US", Intensity = "hype", TemplateText = "What a goal by {TEAM_NAME}! The CriptoVersus Arena erupts!", IsActive = true, Priority = 100, CreatedAtUtc = SeedTimestampUtc, UpdatedAtUtc = SeedTimestampUtc },
            new AudioPhraseTemplate { TemplateKey = "match_start_pt_br_normal", EventType = "match_start", Language = "pt-BR", Intensity = "normal", TemplateText = "{TEAM_NAME} está pronto para começar mais uma batalha na CriptoVersus Arena!", IsActive = true, Priority = 90, CreatedAtUtc = SeedTimestampUtc, UpdatedAtUtc = SeedTimestampUtc },
            new AudioPhraseTemplate { TemplateKey = "match_start_en_us_normal", EventType = "match_start", Language = "en-US", Intensity = "normal", TemplateText = "{TEAM_NAME} is ready to kick off another battle in the CriptoVersus Arena!", IsActive = true, Priority = 90, CreatedAtUtc = SeedTimestampUtc, UpdatedAtUtc = SeedTimestampUtc },
            new AudioPhraseTemplate { TemplateKey = "final_whistle_pt_br_normal", EventType = "final_whistle", Language = "pt-BR", Intensity = "normal", TemplateText = "Fim de jogo para {TEAM_NAME} na CriptoVersus Arena!", IsActive = true, Priority = 80, CreatedAtUtc = SeedTimestampUtc, UpdatedAtUtc = SeedTimestampUtc },
            new AudioPhraseTemplate { TemplateKey = "final_whistle_en_us_normal", EventType = "final_whistle", Language = "en-US", Intensity = "normal", TemplateText = "Final whistle for {TEAM_NAME} in the CriptoVersus Arena!", IsActive = true, Priority = 80, CreatedAtUtc = SeedTimestampUtc, UpdatedAtUtc = SeedTimestampUtc },
            new AudioPhraseTemplate { TemplateKey = "market_pump_pt_br_hype", EventType = "market_pump", Language = "pt-BR", Intensity = "hype", TemplateText = "{TEAM_NAME} acelera forte dentro da arena e ganha o embalo da torcida!", IsActive = true, Priority = 85, CreatedAtUtc = SeedTimestampUtc, UpdatedAtUtc = SeedTimestampUtc },
            new AudioPhraseTemplate { TemplateKey = "market_pump_en_us_hype", EventType = "market_pump", Language = "en-US", Intensity = "hype", TemplateText = "{TEAM_NAME} surges inside the arena and the crowd can feel the momentum rising!", IsActive = true, Priority = 85, CreatedAtUtc = SeedTimestampUtc, UpdatedAtUtc = SeedTimestampUtc },
            new AudioPhraseTemplate { TemplateKey = "market_crash_pt_br_dramatic", EventType = "market_crash", Language = "pt-BR", Intensity = "dramatic", TemplateText = "{TEAM_NAME} sente o impacto e a arena acompanha cada segundo dessa queda!", IsActive = true, Priority = 85, CreatedAtUtc = SeedTimestampUtc, UpdatedAtUtc = SeedTimestampUtc },
            new AudioPhraseTemplate { TemplateKey = "market_crash_en_us_dramatic", EventType = "market_crash", Language = "en-US", Intensity = "dramatic", TemplateText = "{TEAM_NAME} takes a heavy hit and the whole arena can feel the collapse!", IsActive = true, Priority = 85, CreatedAtUtc = SeedTimestampUtc, UpdatedAtUtc = SeedTimestampUtc }
        };

        foreach (var seed in seeds)
        {
            seed.TemplateText = TextMojibakeRepair.Normalize(seed.TemplateText);

            var current = await _db.AudioPhraseTemplate
                .FirstOrDefaultAsync(x => x.TemplateKey == seed.TemplateKey, ct);

            if (current is null)
            {
                _db.AudioPhraseTemplate.Add(seed);
                _logger.LogInformation("Procedural audio template seed inserted. TemplateKey={TemplateKey}", seed.TemplateKey);
                continue;
            }

            current.EventType = seed.EventType;
            current.Language = seed.Language;
            current.ContextKey = seed.ContextKey;
            current.Intensity = seed.Intensity;
            current.TemplateText = seed.TemplateText;
            current.IsActive = seed.IsActive;
            current.Priority = seed.Priority;
            current.UpdatedAtUtc = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
    }

    private async Task UpsertVoiceProfilesAsync(CancellationToken ct)
    {
        var seeds = new[]
        {
            new AudioVoiceProfile
            {
                VoiceKey = "narrator_pt_br",
                Language = "pt-BR",
                DisplayName = "Narrador PT-BR Default",
                SampleRelativePath = "audio/pt-BR/samples/narrator_pt_br.mp3",
                SampleUrl = "/audio/pt-BR/samples/narrator_pt_br.mp3",
                Provider = "local",
                VoiceStyle = "football_narrator",
                IsActive = true,
                Priority = 100,
                CreatedAtUtc = SeedTimestampUtc,
                UpdatedAtUtc = SeedTimestampUtc
            },
            new AudioVoiceProfile
            {
                VoiceKey = "narrator_en_us",
                Language = "en-US",
                DisplayName = "Narrator EN-US Default",
                SampleRelativePath = "audio/en-US/samples/narrator_en_us.mp3",
                SampleUrl = "/audio/en-US/samples/narrator_en_us.mp3",
                Provider = "local",
                VoiceStyle = "esport_narrator",
                IsActive = true,
                Priority = 100,
                CreatedAtUtc = SeedTimestampUtc,
                UpdatedAtUtc = SeedTimestampUtc
            }
        };

        foreach (var seed in seeds)
        {
            var current = await _db.AudioVoiceProfile
                .FirstOrDefaultAsync(x => x.VoiceKey == seed.VoiceKey, ct);

            if (current is null)
            {
                _db.AudioVoiceProfile.Add(seed);
                _logger.LogInformation("Procedural audio voice profile seed inserted. VoiceKey={VoiceKey}", seed.VoiceKey);
                continue;
            }

            current.Language = seed.Language;
            current.DisplayName = seed.DisplayName;
            current.SampleRelativePath = seed.SampleRelativePath;
            current.SampleUrl = seed.SampleUrl;
            current.Provider = seed.Provider;
            current.VoiceStyle = seed.VoiceStyle;
            current.IsActive = seed.IsActive;
            current.Priority = seed.Priority;
            current.UpdatedAtUtc = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
    }
}






