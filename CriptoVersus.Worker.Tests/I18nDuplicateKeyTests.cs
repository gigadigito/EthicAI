using System.Text.Json;

namespace CriptoVersus.Worker.Tests;

public sealed class I18nDuplicateKeyTests
{
    private static readonly string[] CultureFiles = ["en-US", "pt-BR", "zh-CN", "hi-IN"];

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

    [Fact]
    public void HindiFiles_ShouldMatchEnglishKeyStructureAndPlaceholders()
    {
        var repoRoot = FindRepoRoot();
        var errors = new List<string>();

        foreach (var fileName in new[] { "i18n.hi-IN.json", "i18n.faq.hi-IN.json" })
        {
            var hiPath = Path.Combine(repoRoot, "CriptoVersus", fileName);
            var enPath = Path.Combine(repoRoot, "CriptoVersus", fileName.Replace("hi-IN", "en-US"));
            Assert.True(File.Exists(hiPath), $"File not found: {hiPath}");
            Assert.True(File.Exists(enPath), $"File not found: {enPath}");

            using var hiDoc = JsonDocument.Parse(File.ReadAllText(hiPath));
            using var enDoc = JsonDocument.Parse(File.ReadAllText(enPath));
            CompareStructure(enDoc.RootElement, hiDoc.RootElement, fileName, "", errors);
        }

        Assert.True(errors.Count == 0,
            $"Hindi i18n structure/placeholders differ from en-US:\n{string.Join("\n", errors)}");
    }

    private static void CompareStructure(JsonElement en, JsonElement hi, string culture, string path, List<string> errors)
    {
        if (en.ValueKind == JsonValueKind.Object && hi.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in en.EnumerateObject())
            {
                var childPath = string.IsNullOrEmpty(path) ? prop.Name : $"{path}.{prop.Name}";
                if (!hi.TryGetProperty(prop.Name, out var hiChild))
                {
                    errors.Add($"{culture}: missing key '{childPath}'");
                    continue;
                }

                CompareStructure(prop.Value, hiChild, culture, childPath, errors);
            }

            foreach (var prop in hi.EnumerateObject())
            {
                if (!en.TryGetProperty(prop.Name, out _))
                {
                    var childPath = string.IsNullOrEmpty(path) ? prop.Name : $"{path}.{prop.Name}";
                    errors.Add($"{culture}: extra key '{childPath}'");
                }
            }

            return;
        }

        if (en.ValueKind == JsonValueKind.Array && hi.ValueKind == JsonValueKind.Array)
        {
            if (en.GetArrayLength() != hi.GetArrayLength())
            {
                errors.Add($"{culture}: array length mismatch at '{path}' ({hi.GetArrayLength()} vs {en.GetArrayLength()})");
                return;
            }

            var index = 0;
            foreach (var (enItem, hiItem) in en.EnumerateArray().Zip(hi.EnumerateArray()))
            {
                CompareStructure(enItem, hiItem, culture, $"{path}[{index}]", errors);
                index++;
            }

            return;
        }

        if (en.ValueKind == JsonValueKind.String && hi.ValueKind == JsonValueKind.String)
        {
            var enText = en.GetString() ?? string.Empty;
            var hiText = hi.GetString() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(hiText))
            {
                errors.Add($"{culture}: empty value at '{path}'");
                return;
            }

            var enTokens = Placeholders(enText);
            var hiTokens = Placeholders(hiText);
            if (!enTokens.SequenceEqual(hiTokens))
                errors.Add($"{culture}: placeholders mismatch at '{path}' (hi: [{string.Join(", ", hiTokens)}] vs en: [{string.Join(", ", enTokens)}])");

            return;
        }

        if (en.ValueKind != hi.ValueKind)
            errors.Add($"{culture}: value kind mismatch at '{path}' ({hi.ValueKind} vs {en.ValueKind})");
    }

    private static string[] Placeholders(string value)
    {
        var tokens = new List<string>();
        var index = 0;
        while (index < value.Length)
        {
            if (value[index] != '{')
            {
                index++;
                continue;
            }

            var close = value.IndexOf('}', index);
            if (close < 0)
                break;

            tokens.Add(value.Substring(index, close - index + 1));
            index = close + 1;
        }

        return tokens.OrderBy(token => token, StringComparer.Ordinal).ToArray();
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
