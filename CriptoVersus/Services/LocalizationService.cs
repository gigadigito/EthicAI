using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Globalization;
using DTOs;
using Microsoft.Extensions.Logging;

namespace CriptoVersus.Web.Services;

public sealed class LocalizationService
{
    private readonly object _resourceLock = new();
    private readonly AppCultureService _appCultureService;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<LocalizationService> _logger;
    private IReadOnlyDictionary<string, JsonNode?> _resources;
    private DateTime _resourcesLastWriteUtc;
    private readonly JsonSerializerOptions _serializerOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() }
    };

    public LocalizationService(
        IWebHostEnvironment environment,
        AppCultureService appCultureService,
        ILogger<LocalizationService> logger)
    {
        _environment = environment;
        _appCultureService = appCultureService;
        _logger = logger;
        _resources = LoadResources(environment.ContentRootPath);
        _resourcesLastWriteUtc = GetResourcesLastWriteUtc(environment.ContentRootPath);

        if (_environment.IsDevelopment())
        {
            var loadedCultures = string.Join(", ", _resources.Keys.OrderBy(key => key, StringComparer.OrdinalIgnoreCase));
            _logger.LogDebug("[I18N_DEBUG] loaded resource cultures: {Cultures}", loadedCultures);
        }
    }

    public string T(string key, string? culture = null, params object?[] args)
    {
        RefreshResourcesIfNeeded();

        var requestedCulture = culture ?? CultureInfo.CurrentUICulture.Name;
        var normalizedCulture = _appCultureService.ToCultureCode(requestedCulture);
        var translated = GetString(key, normalizedCulture);
        var fallback = translated is null ? GetString(key, AppCultureService.DefaultRouteCulture) : null;

        var template = translated
            ?? fallback
            ?? key;

        if (_environment.IsDevelopment())
        {
            var sourceCulture = translated is not null
                ? normalizedCulture
                : fallback is not null
                    ? AppCultureService.DefaultCultureCode
                    : "key";

            _logger.LogDebug(
                "[I18N_DEBUG] culture={Culture} uiCulture={UICulture} key={Key} source={Source} value={Value}",
                normalizedCulture,
                CultureInfo.CurrentUICulture.Name,
                key,
                sourceCulture,
                template);
        }

        return args.Length == 0
            ? template
            : string.Format(template, args);
    }

    public string? GetString(string key, string? culture = null)
    {
        RefreshResourcesIfNeeded();

        var node = GetNode(key, culture ?? CultureInfo.CurrentUICulture.Name);
        if (node is JsonValue value && value.TryGetValue<string>(out var text))
            return text;

        return node?.ToJsonString().Trim('"');
    }

    public T? GetSection<T>(string key, string? culture = null)
    {
        RefreshResourcesIfNeeded();

        var node = GetNode(key, culture ?? CultureInfo.CurrentUICulture.Name) ?? GetNode(key, AppCultureService.DefaultRouteCulture);
        return node is null ? default : node.Deserialize<T>(_serializerOptions);
    }

    private void RefreshResourcesIfNeeded()
    {
        if (!_environment.IsDevelopment())
            return;

        var currentStamp = GetResourcesLastWriteUtc(_environment.ContentRootPath);
        if (currentStamp <= _resourcesLastWriteUtc)
            return;

        lock (_resourceLock)
        {
            currentStamp = GetResourcesLastWriteUtc(_environment.ContentRootPath);
            if (currentStamp <= _resourcesLastWriteUtc)
                return;

            _resources = LoadResources(_environment.ContentRootPath);
            _resourcesLastWriteUtc = currentStamp;

            var loadedCultures = string.Join(", ", _resources.Keys.OrderBy(key => key, StringComparer.OrdinalIgnoreCase));
            _logger.LogDebug("[I18N_DEBUG] reloaded resource cultures: {Cultures}", loadedCultures);
        }
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
            var segments = fileName.Split('.', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (segments.Length != 2 || !segments[0].Equals("i18n", StringComparison.OrdinalIgnoreCase))
                continue;

            var cultureCode = segments[1];
            result[cultureCode] = NormalizeJsonNode(JsonNode.Parse(File.ReadAllText(filePath)));
        }

        foreach (var filePath in Directory.GetFiles(contentRootPath, "i18n.*.*.json", SearchOption.TopDirectoryOnly))
        {
            var fileName = Path.GetFileNameWithoutExtension(filePath);
            var segments = fileName.Split('.', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (segments.Length != 3 || !segments[0].Equals("i18n", StringComparison.OrdinalIgnoreCase))
                continue;

            var sectionName = segments[1];
            var cultureCode = segments[2];
            if (!result.TryGetValue(cultureCode, out var root) || root is not JsonObject rootObject)
                continue;

            var extensionRoot = NormalizeJsonNode(JsonNode.Parse(File.ReadAllText(filePath)));
            if (extensionRoot is null)
                continue;

            rootObject[sectionName] = extensionRoot.DeepClone();
        }

        return result;
    }

    private static JsonNode? NormalizeJsonNode(JsonNode? node)
    {
        if (node is JsonObject obj)
        {
            var normalized = new JsonObject();
            foreach (var property in obj)
                normalized[property.Key] = NormalizeJsonNode(property.Value)?.DeepClone();

            return normalized;
        }

        if (node is JsonArray array)
        {
            var normalized = new JsonArray();
            foreach (var item in array)
                normalized.Add(NormalizeJsonNode(item)?.DeepClone());

            return normalized;
        }

        if (node is JsonValue value && value.TryGetValue<string>(out var text) && TextMojibakeRepair.LooksLikeMojibake(text))
            return JsonValue.Create(TextMojibakeRepair.Normalize(text));

        return node is null ? null : node.DeepClone();
    }

    private static DateTime GetResourcesLastWriteUtc(string contentRootPath)
    {
        var latest = DateTime.MinValue;

        foreach (var filePath in Directory.GetFiles(contentRootPath, "i18n.*.json", SearchOption.TopDirectoryOnly))
        {
            latest = MaxUtc(latest, File.GetLastWriteTimeUtc(filePath));
        }

        foreach (var filePath in Directory.GetFiles(contentRootPath, "i18n.*.*.json", SearchOption.TopDirectoryOnly))
        {
            latest = MaxUtc(latest, File.GetLastWriteTimeUtc(filePath));
        }

        return latest;
    }

    private static DateTime MaxUtc(DateTime left, DateTime right)
        => left >= right ? left : right;
}
