using CriptoVersus.API.Contracts;
using Microsoft.Extensions.Caching.Memory;
using SkiaSharp;

namespace CriptoVersus.API.Services;

public interface ISocialVsRenderService
{
    Task<byte[]> RenderAsync(SocialVsRenderRequest request, CancellationToken ct);
}

public sealed class SocialVsRenderService : ISocialVsRenderService
{
    private const int CanvasWidth = 1536;
    private const int CanvasHeight = 1024;
    private const string FallbackVsAssetPath = "social/vs-suggestion.png";

    private readonly IMemoryCache _cache;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<SocialVsRenderService> _logger;

    public SocialVsRenderService(
        IMemoryCache cache,
        IHttpClientFactory httpClientFactory,
        IHttpContextAccessor httpContextAccessor,
        IWebHostEnvironment environment,
        ILogger<SocialVsRenderService> logger)
    {
        _cache = cache;
        _httpClientFactory = httpClientFactory;
        _httpContextAccessor = httpContextAccessor;
        _environment = environment;
        _logger = logger;
    }

    public async Task<byte[]> RenderAsync(SocialVsRenderRequest request, CancellationToken ct)
    {
        var leftSymbol = NormalizeSymbol(request.LeftSymbol);
        var rightSymbol = NormalizeSymbol(request.RightSymbol);
        var score = NormalizeScore(request.Score);

        if (string.IsNullOrWhiteSpace(leftSymbol) || string.IsNullOrWhiteSpace(rightSymbol))
            throw new ArgumentException("Both leftSymbol and rightSymbol are required.");

        var cacheKey = $"social-vs:{leftSymbol}:{rightSymbol}:{score}";
        if (_cache.TryGetValue<byte[]>(cacheKey, out var cached) && cached is not null)
            return cached;

        var leftLogoTask = LoadIconAsync(leftSymbol, ct);
        var rightLogoTask = LoadIconAsync(rightSymbol, ct);
        var vsAssetTask = LoadVsAssetAsync(ct);

        await Task.WhenAll(leftLogoTask, rightLogoTask, vsAssetTask);

        var bytes = RenderPng(
            leftSymbol,
            rightSymbol,
            score,
            await leftLogoTask,
            await rightLogoTask,
            await vsAssetTask);

        _cache.Set(cacheKey, bytes, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30),
            SlidingExpiration = TimeSpan.FromMinutes(10),
            Size = Math.Max(1, bytes.Length / 1024)
        });

        return bytes;
    }

    private async Task<SKBitmap?> LoadIconAsync(string symbol, CancellationToken ct)
    {
        var cacheKey = $"social-vs:icon:{symbol}";
        if (_cache.TryGetValue<byte[]>(cacheKey, out var cachedBytes) && cachedBytes is not null)
            return SKBitmap.Decode(cachedBytes);

        try
        {
            var client = _httpClientFactory.CreateClient(nameof(SocialVsRenderService));
            var iconUrl = BuildIconUrl(symbol);
            using var response = await client.GetAsync(iconUrl, ct);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Could not fetch icon for {Symbol}. Status: {StatusCode}", symbol, response.StatusCode);
                return null;
            }

            var bytes = await response.Content.ReadAsByteArrayAsync(ct);
            _cache.Set(cacheKey, bytes, new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(12),
                Size = Math.Max(1, bytes.Length / 1024)
            });

            return SKBitmap.Decode(bytes);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not load icon for {Symbol}", symbol);
            return null;
        }
    }

    private async Task<SKBitmap?> LoadVsAssetAsync(CancellationToken ct)
    {
        const string cacheKey = "social-vs:asset:vs-suggestion";
        if (_cache.TryGetValue<byte[]>(cacheKey, out var cachedBytes) && cachedBytes is not null)
            return SKBitmap.Decode(cachedBytes);

        var assetPath = Path.Combine(_environment.WebRootPath ?? string.Empty, FallbackVsAssetPath.Replace('/', Path.DirectorySeparatorChar));
        if (!File.Exists(assetPath))
            return null;

        var bytes = await File.ReadAllBytesAsync(assetPath, ct);
        _cache.Set(cacheKey, bytes, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromDays(7),
            Size = Math.Max(1, bytes.Length / 1024)
        });

        return SKBitmap.Decode(bytes);
    }

    private string BuildIconUrl(string symbol)
    {
        var request = _httpContextAccessor.HttpContext?.Request;
        if (request is not null)
            return $"{request.Scheme}://{request.Host}{request.PathBase}/api/icons/binance/{symbol}";

        return $"https://api.criptoversus.com/api/icons/binance/{symbol}";
    }

    private static string NormalizeSymbol(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return string.Empty;

        return new string(value.Trim().ToUpperInvariant().Where(char.IsLetterOrDigit).Take(20).ToArray());
    }

    private static string NormalizeScore(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return string.Empty;

        var cleaned = value.Trim();
        cleaned = cleaned.Replace("X", "x", StringComparison.Ordinal);
        return cleaned.Length > 20 ? cleaned[..20] : cleaned;
    }

    private static byte[] RenderPng(
        string leftSymbol,
        string rightSymbol,
        string score,
        SKBitmap? leftLogo,
        SKBitmap? rightLogo,
        SKBitmap? vsAsset)
    {
        var imageInfo = new SKImageInfo(CanvasWidth, CanvasHeight, SKColorType.Rgba8888, SKAlphaType.Premul);
        using var surface = SKSurface.Create(imageInfo);
        var canvas = surface.Canvas;
        canvas.Clear(SKColors.Transparent);

        DrawCenterVs(canvas, vsAsset);

        DrawLogoCluster(
            canvas,
            leftLogo,
            new SKPoint(CanvasWidth * 0.33f, CanvasHeight * 0.47f),
            leftSymbol,
            new SKColor(58, 183, 255, 255),
            new SKColor(0, 229, 255, 180));

        DrawLogoCluster(
            canvas,
            rightLogo,
            new SKPoint(CanvasWidth * 0.67f, CanvasHeight * 0.47f),
            rightSymbol,
            new SKColor(203, 79, 255, 255),
            new SKColor(255, 72, 120, 180));

        if (!string.IsNullOrWhiteSpace(score))
            DrawScore(canvas, score);

        using var image = surface.Snapshot();
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }

    private static void DrawCenterVs(SKCanvas canvas, SKBitmap? vsAsset)
    {
        var bounds = new SKRect(CanvasWidth * 0.41f, CanvasHeight * 0.28f, CanvasWidth * 0.59f, CanvasHeight * 0.66f);

        using var burstPaint = new SKPaint
        {
            IsAntialias = true,
            Color = new SKColor(255, 64, 128, 28),
            MaskFilter = SKMaskFilter.CreateBlur(SKBlurStyle.Normal, 34)
        };
        canvas.DrawOval(new SKRect(bounds.Left + 16, bounds.MidY - 82, bounds.Right - 16, bounds.MidY + 82), burstPaint);

        if (vsAsset is not null)
        {
            using var vsPaint = new SKPaint
            {
                IsAntialias = true,
                FilterQuality = SKFilterQuality.High,
                Color = SKColors.White.WithAlpha(245)
            };

            canvas.DrawBitmap(vsAsset, bounds, vsPaint);
            return;
        }

        using var glowPaint = new SKPaint
        {
            IsAntialias = true,
            Color = new SKColor(255, 92, 31, 176),
            MaskFilter = SKMaskFilter.CreateBlur(SKBlurStyle.Normal, 30)
        };
        canvas.DrawOval(new SKRect(bounds.Left + 28, bounds.MidY - 70, bounds.Right - 28, bounds.MidY + 70), glowPaint);

        using var strokePaint = new SKPaint
        {
            IsAntialias = true,
            Style = SKPaintStyle.Stroke,
            StrokeWidth = 12,
            StrokeJoin = SKStrokeJoin.Round,
            Color = new SKColor(30, 0, 0, 210)
        };

        using var fillPaint = new SKPaint
        {
            IsAntialias = true,
            Shader = SKShader.CreateLinearGradient(
                new SKPoint(bounds.Left, bounds.Top),
                new SKPoint(bounds.Right, bounds.Bottom),
                new[] { new SKColor(255, 100, 42), new SKColor(255, 32, 48) },
                new float[] { 0f, 1f },
                SKShaderTileMode.Clamp)
        };
        strokePaint.TextSize = 188;
        strokePaint.Typeface = SKTypeface.FromFamilyName("Arial", SKFontStyle.Bold);
        strokePaint.TextAlign = SKTextAlign.Center;
        fillPaint.TextSize = 188;
        fillPaint.Typeface = SKTypeface.FromFamilyName("Arial", SKFontStyle.Bold);
        fillPaint.TextAlign = SKTextAlign.Center;

        var vsText = "VS";
        var textBounds = new SKRect();
        fillPaint.MeasureText(vsText, ref textBounds);
        var x = bounds.MidX;
        var y = bounds.MidY - textBounds.MidY;
        canvas.DrawText(vsText, x, y, strokePaint);
        canvas.DrawText(vsText, x, y, fillPaint);
    }

    private static void DrawLogoCluster(SKCanvas canvas, SKBitmap? logo, SKPoint center, string symbol, SKColor rim, SKColor glow)
    {
        using var glowPaint = new SKPaint
        {
            IsAntialias = true,
            Color = glow,
            MaskFilter = SKMaskFilter.CreateBlur(SKBlurStyle.Normal, 26)
        };
        canvas.DrawCircle(center, 112, glowPaint);

        if (logo is not null)
        {
            var rect = SKRect.Create(center.X - 78, center.Y - 78, 156, 156);
            using var logoPaint = new SKPaint
            {
                IsAntialias = true,
                FilterQuality = SKFilterQuality.High
            };
            canvas.DrawBitmap(logo, rect, logoPaint);
        }
        else
        {
            using var symbolPaint = new SKPaint
            {
                IsAntialias = true,
                Color = rim,
                FakeBoldText = true,
                TextSize = 54,
                Typeface = SKTypeface.FromFamilyName("Arial", SKFontStyle.Bold),
                TextAlign = SKTextAlign.Center
            };

            var textBounds = new SKRect();
            symbolPaint.MeasureText(symbol, ref textBounds);
            canvas.DrawText(symbol, center.X, center.Y - textBounds.MidY, symbolPaint);
        }
    }

    private static void DrawScore(SKCanvas canvas, string score)
    {
        using var scoreGlowPaint = new SKPaint
        {
            IsAntialias = true,
            Color = new SKColor(255, 130, 60, 124),
            MaskFilter = SKMaskFilter.CreateBlur(SKBlurStyle.Normal, 14)
        };
        using var scorePaint = new SKPaint
        {
            IsAntialias = true,
            Color = SKColors.White,
            FakeBoldText = true,
            TextSize = 36,
            Typeface = SKTypeface.FromFamilyName("Arial", SKFontStyle.Bold),
            TextAlign = SKTextAlign.Center
        };
        scoreGlowPaint.TextSize = 36;
        scoreGlowPaint.Typeface = SKTypeface.FromFamilyName("Arial", SKFontStyle.Bold);
        scoreGlowPaint.TextAlign = SKTextAlign.Center;

        var textBounds = new SKRect();
        scorePaint.MeasureText(score, ref textBounds);
        var x = CanvasWidth * 0.5f;
        var y = CanvasHeight * 0.71f - textBounds.MidY;
        canvas.DrawText(score, x, y, scoreGlowPaint);
        canvas.DrawText(score, x, y, scorePaint);
    }
}
