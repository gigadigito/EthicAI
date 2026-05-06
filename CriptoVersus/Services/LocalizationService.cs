using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace CriptoVersus.Web.Services;

public sealed class LocalizationService
{
    private readonly AppCultureService _appCultureService;
    private readonly IReadOnlyDictionary<string, JsonNode?> _resources;
    private readonly JsonSerializerOptions _serializerOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() }
    };

    public LocalizationService(IWebHostEnvironment environment, AppCultureService appCultureService)
    {
        _appCultureService = appCultureService;
        _resources = LoadResources(environment.ContentRootPath);
    }

    public string T(string key, string? culture = null, params object?[] args)
    {
        var template = GetString(key, culture)
            ?? GetString(key, AppCultureService.DefaultRouteCulture)
            ?? key;

        return args.Length == 0
            ? template
            : string.Format(template, args);
    }

    public string? GetString(string key, string? culture = null)
    {
        var node = GetNode(key, culture);
        if (node is JsonValue value && value.TryGetValue<string>(out var text))
            return text;

        return node?.ToJsonString().Trim('"');
    }

    public T? GetSection<T>(string key, string? culture = null)
    {
        var node = GetNode(key, culture) ?? GetNode(key, AppCultureService.DefaultRouteCulture);
        return node is null ? default : node.Deserialize<T>(_serializerOptions);
    }

    private JsonNode? GetNode(string key, string? culture)
    {
        var normalizedCulture = _appCultureService.ToCultureCode(culture);
        if (!_resources.TryGetValue(normalizedCulture, out var root) || root is null)
            return null;

        JsonNode? current = root;
        foreach (var segment in key.Split('.', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            current = current?[segment];
            if (current is null)
                return null;
        }

        return current;
    }

    private static IReadOnlyDictionary<string, JsonNode?> LoadResources(string contentRootPath)
    {
        var result = new Dictionary<string, JsonNode?>(StringComparer.OrdinalIgnoreCase);

        foreach (var filePath in Directory.GetFiles(contentRootPath, "i18n.*.json", SearchOption.TopDirectoryOnly))
        {
            var fileName = Path.GetFileNameWithoutExtension(filePath);
            var cultureCode = fileName["i18n.".Length..];
            result[cultureCode] = JsonNode.Parse(File.ReadAllText(filePath));
        }

        return result;
    }
}
