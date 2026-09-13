using System.Text.Json;

namespace CriptoVersus.Worker.Tests;

public sealed class I18nDuplicateKeyTests
{
    private static readonly string[] CultureFiles = ["en-US", "pt-BR", "zh-CN"];

    [Fact]
    public void I18nFiles_ShouldNotContainDuplicateKeys()
    {
        var repoRoot = FindRepoRoot();
        var errors = new List<string>();

        foreach (var culture in CultureFiles)
        {
            var filePath = Path.Combine(repoRoot, "CriptoVersus", $"i18n.{culture}.json");
            if (!File.Exists(filePath))
            {
                errors.Add($"File not found: {filePath}");
                continue;
            }

            var text = File.ReadAllText(filePath);
            using var doc = JsonDocument.Parse(text);
            FindDuplicateKeys(doc.RootElement, culture, "", errors);
        }

        Assert.True(errors.Count == 0,
            $"Duplicate keys found in i18n files:\n{string.Join("\n", errors)}");
    }

    [Fact]
    public void I18nFiles_ShouldBeValidJson()
    {
        var repoRoot = FindRepoRoot();
        var errors = new List<string>();

        foreach (var culture in CultureFiles)
        {
            var filePath = Path.Combine(repoRoot, "CriptoVersus", $"i18n.{culture}.json");
            if (!File.Exists(filePath))
            {
                errors.Add($"File not found: {filePath}");
                continue;
            }

            try
            {
                var text = File.ReadAllText(filePath);
                JsonDocument.Parse(text);
            }
            catch (JsonException ex)
            {
                errors.Add($"{culture}: invalid JSON - {ex.Message}");
            }
        }

        Assert.True(errors.Count == 0,
            $"Invalid JSON in i18n files:\n{string.Join("\n", errors)}");
    }

    private static void FindDuplicateKeys(JsonElement element, string culture, string path, List<string> errors)
    {
        if (element.ValueKind != JsonValueKind.Object)
            return;

        var seen = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var prop in element.EnumerateObject())
        {
            var fullPath = string.IsNullOrEmpty(path) ? prop.Name : $"{path}.{prop.Name}";
            if (seen.TryGetValue(prop.Name, out var firstLine))
            {
                errors.Add($"{culture}: duplicate key '{fullPath}' (first at line ~{firstLine})");
            }
            else
            {
                seen[prop.Name] = 0;
            }

            FindDuplicateKeys(prop.Value, culture, fullPath, errors);
        }
    }

    private static string FindRepoRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir, "EthicAI.sln")))
                return dir;
            dir = Directory.GetParent(dir)?.FullName;
        }
        return AppContext.BaseDirectory;
    }
}
