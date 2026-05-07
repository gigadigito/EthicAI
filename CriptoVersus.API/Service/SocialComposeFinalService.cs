using System.Security.Cryptography;
using System.Text;
using CriptoVersus.API.Contracts;
using Microsoft.Extensions.Caching.Memory;
using SkiaSharp;

namespace CriptoVersus.API.Services;

public interface ISocialComposeFinalService
{
    Task<byte[]> ComposeAsync(SocialComposeFinalRequest request, CancellationToken ct);
}

public sealed class SocialComposeFinalService : ISocialComposeFinalService
{
    private const int CanvasWidth = 1536;
    private const int CanvasHeight = 1024;

    private readonly IMemoryCache _cache;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly ILogger<SocialComposeFinalService> _logger;

    public SocialComposeFinalService(
        IMemoryCache cache,
        IHttpClientFactory httpClientFactory,
        IHttpContextAccessor httpContextAccessor,
        ILogger<SocialComposeFinalService> logger)
    {
        _cache = cache;
        _httpClientFactory = httpClientFactory;
        _httpContextAccessor = httpContextAccessor;
        _logger = logger;
    }

    public async Task<byte[]> ComposeAsync(SocialComposeFinalRequest request, CancellationToken ct)
    {
        var leftSymbol = NormalizeSymbol(request.LeftSymbol);
        var rightSymbol = NormalizeSymbol(request.RightSymbol);
        var score = NormalizeScore(request.Score);
        var backgroundBase64 = request.BackgroundImageBase64?.Trim() ?? string.Empty;

        if (string.IsNullOrWhiteSpace(backgroundBase64))
            throw new ArgumentException("backgroundImageBase64 is required.");

        if (string.IsNullOrWhiteSpace(leftSymbol) || string.IsNullOrWhiteSpace(rightSymbol))
            throw new ArgumentException("Both leftSymbol and rightSymbol are required.");

        var cacheKey = $"social-compose:{leftSymbol}:{rightSymbol}:{score}:{ComputeHash(backgroundBase64)}";
        if (_cache.TryGetValue<byte[]>(cacheKey, out var cached) && cached is not null)
            return cached;

        var backgroundBytes = DecodeBackground(backgroundBase64);
        using var backgroundBitmap = SKBitmap.Decode(backgroundBytes);
        if (backgroundBitmap is null)
            throw new ArgumentException("backgroundImageBase64 could not be decoded into a valid image.");

        var leftLogoTask = LoadIconAsync(leftSymbol, ct);
        var rightLogoTask = LoadIconAsync(rightSymbol, ct);
        await Task.WhenAll(leftLogoTask, rightLogoTask);

        var bytes = RenderPng(
            backgroundBitmap,
            await leftLogoTask,
            await rightLogoTask,
            leftSymbol,
            rightSymbol,
            score);

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
        var cacheKey = $"social-compose:icon:{symbol}";
        if (_cache.TryGetValue<byte[]>(cacheKey, out var cachedBytes) && cachedBytes is not null)
            return SKBitmap.Decode(cachedBytes);

        try
        {
            var client = _httpClientFactory.CreateClient(nameof(SocialComposeFinalService));
            using var response = await client.GetAsync(BuildIconUrl(symbol), ct);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Could not fetch compose-final icon for {Symbol}. Status: {StatusCode}", symbol, response.StatusCode);
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
            _logger.LogWarning(ex, "Could not load compose-final icon for {Symbol}", symbol);
            return null;
        }
    }

    private string BuildIconUrl(string symbol)
    {
        var request = _httpContextAccessor.HttpContext?.Request;
        if (request is not null)
            return $"{request.Scheme}://{request.Host}{request.PathBase}/api/icons/binance/{symbol}";

        return $"https://api.criptoversus.com/api/icons/binance/{symbol}";
    }

    private static byte[] DecodeBackground(string value)
    {
        var payload = value;
        const string marker = "base64,";
        var markerIndex = payload.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (markerIndex >= 0)
            payload = payload[(markerIndex + marker.Length)..];

        payload = payload.Trim();
        if (string.IsNullOrWhiteSpace(payload))
            throw new ArgumentException("backgroundImageBase64 is empty.");

        try
        {
            return Convert.FromBase64String(payload);
        }
        catch (FormatException ex)
        {
            throw new ArgumentException("backgroundImageBase64 is not valid base64.", ex);
        }
    }

    private static string ComputeHash(string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(bytes[..8]);
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

        var cleaned = value.Trim().Replace(" ", string.Empty, StringComparison.Ordinal);
        cleaned = cleaned.Replace("X", "x", StringComparison.Ordinal);
        return cleaned.Length > 20 ? cleaned[..20] : cleaned;
    }

    private static byte[] RenderPng(
        SKBitmap backgroundBitmap,
        SKBitmap? leftLogo,
        SKBitmap? rightLogo,
        string leftSymbol,
        string rightSymbol,
        string score)
    {
        var imageInfo = new SKImageInfo(CanvasWidth, CanvasHeight, SKColorType.Rgba8888, SKAlphaType.Premul);
        using var surface = SKSurface.Create(imageInfo);
        var canvas = surface.Canvas;
        canvas.Clear(SKColors.Transparent);

        DrawBackground(canvas, backgroundBitmap);
        DrawHud(canvas, leftLogo, rightLogo, leftSymbol, rightSymbol, score);

        using var image = surface.Snapshot();
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }

    private static void DrawBackground(SKCanvas canvas, SKBitmap backgroundBitmap)
    {
        var sourceAspect = backgroundBitmap.Width / (float)backgroundBitmap.Height;
        var targetAspect = CanvasWidth / (float)CanvasHeight;

        SKRect sourceRect;
        if (sourceAspect > targetAspect)
        {
            var cropWidth = backgroundBitmap.Height * targetAspect;
            var left = (backgroundBitmap.Width - cropWidth) / 2f;
            sourceRect = new SKRect(left, 0, left + cropWidth, backgroundBitmap.Height);
        }
        else
        {
            var cropHeight = backgroundBitmap.Width / targetAspect;
            var top = (backgroundBitmap.Height - cropHeight) / 2f;
            sourceRect = new SKRect(0, top, backgroundBitmap.Width, top + cropHeight);
        }

        var destRect = new SKRect(0, 0, CanvasWidth, CanvasHeight);
        using var paint = new SKPaint
        {
            IsAntialias = true,
            FilterQuality = SKFilterQuality.High
        };
        canvas.DrawBitmap(backgroundBitmap, sourceRect, destRect, paint);
    }

    private static void DrawHud(
        SKCanvas canvas,
        SKBitmap? leftLogo,
        SKBitmap? rightLogo,
        string leftSymbol,
        string rightSymbol,
        string score)
    {
        var hudRect = new SKRect(328, 846, 1208, 966);

        using var shadowPaint = new SKPaint
        {
            IsAntialias = true,
            Color = new SKColor(0, 0, 0, 116),
            MaskFilter = SKMaskFilter.CreateBlur(SKBlurStyle.Normal, 18)
        };
        canvas.DrawRoundRect(new SKRoundRect(new SKRect(hudRect.Left, hudRect.Top + 8, hudRect.Right, hudRect.Bottom + 8), 34, 34), shadowPaint);

        using var hudPaint = new SKPaint
        {
            IsAntialias = true,
            Color = new SKColor(5, 8, 16, 176)
        };
        using var rimPaint = new SKPaint
        {
            IsAntialias = true,
            Style = SKPaintStyle.Stroke,
            StrokeWidth = 2.5f,
            Color = new SKColor(255, 255, 255, 44)
        };

        canvas.DrawRoundRect(new SKRoundRect(hudRect, 34, 34), hudPaint);
        canvas.DrawRoundRect(new SKRoundRect(hudRect, 34, 34), rimPaint);

        DrawSideGlow(canvas, new SKPoint(hudRect.Left + 145, hudRect.MidY), new SKColor(0, 229, 255, 120));
        DrawSideGlow(canvas, new SKPoint(hudRect.Right - 145, hudRect.MidY), new SKColor(255, 72, 120, 120));

        DrawHudLogo(canvas, leftLogo, new SKPoint(hudRect.Left + 92, hudRect.MidY), leftSymbol, new SKColor(0, 229, 255, 255));
        DrawHudLogo(canvas, rightLogo, new SKPoint(hudRect.Right - 92, hudRect.MidY), rightSymbol, new SKColor(255, 72, 120, 255));

        DrawHudLabel(canvas, leftSymbol, hudRect.Left + 214, hudRect.MidY + 6, SKTextAlign.Left);
        DrawHudLabel(canvas, rightSymbol, hudRect.Right - 214, hudRect.MidY + 6, SKTextAlign.Right);
        DrawVsBadge(canvas, hudRect.MidX, hudRect.Top + 38);
        DrawHudScore(canvas, score, hudRect.MidX, hudRect.Bottom - 34);
    }

    private static void DrawSideGlow(SKCanvas canvas, SKPoint center, SKColor color)
    {
        using var glowPaint = new SKPaint
        {
            IsAntialias = true,
            Color = color,
            MaskFilter = SKMaskFilter.CreateBlur(SKBlurStyle.Normal, 24)
        };
        canvas.DrawCircle(center, 44, glowPaint);
    }

    private static void DrawHudLogo(SKCanvas canvas, SKBitmap? logo, SKPoint center, string symbol, SKColor fallbackColor)
    {
        if (logo is not null)
        {
            var rect = SKRect.Create(center.X - 36, center.Y - 36, 72, 72);
            using var paint = new SKPaint
            {
                IsAntialias = true,
                FilterQuality = SKFilterQuality.High
            };
            canvas.DrawBitmap(logo, rect, paint);
            return;
        }

        using var fallbackPaint = new SKPaint
        {
            IsAntialias = true,
            Color = fallbackColor,
            FakeBoldText = true,
            TextSize = 24,
            Typeface = SKTypeface.FromFamilyName("Arial", SKFontStyle.Bold),
            TextAlign = SKTextAlign.Center
        };
        var bounds = new SKRect();
        fallbackPaint.MeasureText(symbol, ref bounds);
        canvas.DrawText(symbol, center.X, center.Y - bounds.MidY, fallbackPaint);
    }

    private static void DrawHudLabel(SKCanvas canvas, string text, float x, float y, SKTextAlign align)
    {
        using var shadowPaint = new SKPaint
        {
            IsAntialias = true,
            Color = new SKColor(0, 0, 0, 172),
            FakeBoldText = true,
            TextSize = 30,
            Typeface = SKTypeface.FromFamilyName("Arial", SKFontStyle.Bold),
            TextAlign = align
        };
        using var textPaint = new SKPaint
        {
            IsAntialias = true,
            Color = SKColors.White,
            FakeBoldText = true,
            TextSize = 30,
            Typeface = SKTypeface.FromFamilyName("Arial", SKFontStyle.Bold),
            TextAlign = align
        };

        canvas.DrawText(text, x, y + 2, shadowPaint);
        canvas.DrawText(text, x, y, textPaint);
    }

    private static void DrawVsBadge(SKCanvas canvas, float centerX, float topY)
    {
        var rect = new SKRect(centerX - 52, topY - 10, centerX + 52, topY + 30);

        using var glowPaint = new SKPaint
        {
            IsAntialias = true,
            Color = new SKColor(255, 104, 32, 118),
            MaskFilter = SKMaskFilter.CreateBlur(SKBlurStyle.Normal, 14)
        };
        canvas.DrawRoundRect(new SKRoundRect(rect, 18, 18), glowPaint);

        using var platePaint = new SKPaint
        {
            IsAntialias = true,
            Color = new SKColor(26, 10, 4, 186)
        };
        using var rimPaint = new SKPaint
        {
            IsAntialias = true,
            Style = SKPaintStyle.Stroke,
            StrokeWidth = 2,
            Color = new SKColor(255, 180, 90, 96)
        };
        using var textPaint = new SKPaint
        {
            IsAntialias = true,
            Color = SKColors.White,
            FakeBoldText = true,
            TextSize = 22,
            Typeface = SKTypeface.FromFamilyName("Arial", SKFontStyle.Bold),
            TextAlign = SKTextAlign.Center
        };

        canvas.DrawRoundRect(new SKRoundRect(rect, 18, 18), platePaint);
        canvas.DrawRoundRect(new SKRoundRect(rect, 18, 18), rimPaint);

        var bounds = new SKRect();
        textPaint.MeasureText("VS", ref bounds);
        canvas.DrawText("VS", centerX, rect.MidY - bounds.MidY, textPaint);
    }

    private static void DrawHudScore(SKCanvas canvas, string score, float centerX, float baselineY)
    {
        var text = string.IsNullOrWhiteSpace(score) ? "VS" : score;

        using var glowPaint = new SKPaint
        {
            IsAntialias = true,
            Color = new SKColor(255, 118, 54, 128),
            FakeBoldText = true,
            TextSize = 42,
            Typeface = SKTypeface.FromFamilyName("Arial", SKFontStyle.Bold),
            TextAlign = SKTextAlign.Center,
            MaskFilter = SKMaskFilter.CreateBlur(SKBlurStyle.Normal, 12)
        };
        using var textPaint = new SKPaint
        {
            IsAntialias = true,
            Color = SKColors.White,
            FakeBoldText = true,
            TextSize = 42,
            Typeface = SKTypeface.FromFamilyName("Arial", SKFontStyle.Bold),
            TextAlign = SKTextAlign.Center
        };

        canvas.DrawText(text, centerX, baselineY, glowPaint);
        canvas.DrawText(text, centerX, baselineY, textPaint);
    }
}
