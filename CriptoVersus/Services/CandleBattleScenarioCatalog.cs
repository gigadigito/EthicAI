using System.Text.Json;

namespace CriptoVersus.Web.Services;

/// <summary>
/// Immutable registry of compiled mock scenarios, keyed by their fictional
/// MatchId. Loaded once at startup; never mutated, so every circuit, tab and
/// component instance reads exactly the same deterministic data.
/// </summary>
public sealed class CandleBattleScenarioCatalog
{
    public const string DefaultFolder = "mock-data/candle-battles/scenarios";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    private readonly IReadOnlyDictionary<int, CandleBattleScenario> _byMatchId;
    private readonly IReadOnlyDictionary<string, CandleBattleScenario> _byKey;

    public CandleBattleScenarioCatalog(IHostEnvironment environment)
        : this(Path.Combine(environment.ContentRootPath, "mock-data", "candle-battles", "scenarios"))
    {
    }

    public CandleBattleScenarioCatalog(string directory)
    {
        Directory = directory;
        var scenarios = new List<CandleBattleScenario>();
        if (System.IO.Directory.Exists(directory))
        {
            foreach (var path in System.IO.Directory.EnumerateFiles(directory, "*.json").OrderBy(p => p, StringComparer.Ordinal))
            {
                var file = JsonSerializer.Deserialize<CandleBattleScenarioFile>(File.ReadAllText(path), JsonOptions)
                    ?? throw new InvalidDataException($"Mock scenario '{path}' deserialized to null.");
                scenarios.Add(CandleBattleScenarioCompiler.Compile(file));
            }
        }
        if (scenarios.Count == 0)
            throw new InvalidDataException($"No Candle Battle mock scenarios found in '{directory}'.");
        if (scenarios.Select(s => s.MatchId).Distinct().Count() != scenarios.Count)
            throw new InvalidDataException("Every Candle Battle mock scenario must own a unique MatchId.");
        if (scenarios.Select(s => s.Key).Distinct(StringComparer.OrdinalIgnoreCase).Count() != scenarios.Count)
            throw new InvalidDataException("Every Candle Battle mock scenario must own a unique key.");

        Scenarios = scenarios.OrderBy(s => s.MatchId).ToArray();
        _byMatchId = Scenarios.ToDictionary(s => s.MatchId);
        _byKey = Scenarios.ToDictionary(s => s.Key, StringComparer.OrdinalIgnoreCase);
    }

    public string Directory { get; }

    public IReadOnlyList<CandleBattleScenario> Scenarios { get; }

    public CandleBattleScenario? FindByMatchId(int matchId)
        => _byMatchId.TryGetValue(matchId, out var scenario) ? scenario : null;

    public CandleBattleScenario? FindByKey(string? key)
        => !string.IsNullOrWhiteSpace(key) && _byKey.TryGetValue(key, out var scenario) ? scenario : null;
}
