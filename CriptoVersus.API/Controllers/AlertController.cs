using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using System.Globalization;
using System.Text;

namespace CriptoVersus.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AlertController : ControllerBase
    {
        private readonly IWebHostEnvironment _environment;

        private const int Width = 1500;
        private const int Height = 1060;

        private static readonly Dictionary<int, (int X, int Y, string Nome)> Markers = new()
        {
            { 1,  (820, 470, "Linha 1-Azul") },
            { 2,  (700, 520, "Linha 2-Verde") },
            { 3,  (980, 355, "Linha 3-Vermelha") },
            { 4,  (520, 540, "Linha 4-Amarela") },
            { 5,  (560, 760, "Linha 5-Lilás") },
            { 7,  (430, 250, "Linha 7-Rubi") },
            { 8,  (300, 300, "Linha 8-Diamante") },
            { 9,  (360, 560, "Linha 9-Esmeralda") },
            { 10, (900, 520, "Linha 10-Turquesa") },
            { 11, (1030, 355, "Linha 11-Coral") },
            { 12, (980, 300, "Linha 12-Safira") },
            { 13, (1190, 210, "Linha 13-Jade") },
            { 15, (1060, 650, "Linha 15-Prata") }
        };

        public AlertController(IWebHostEnvironment environment)
        {
            _environment = environment;
        }

        [HttpGet("mapa-trilhos")]
        public IActionResult GetMapaTrilhos(
            [FromQuery] string? l1 = null,
            [FromQuery] string? l2 = null,
            [FromQuery] string? l3 = null,
            [FromQuery] string? l4 = null,
            [FromQuery] string? l5 = null,
            [FromQuery] string? l7 = null,
            [FromQuery] string? l8 = null,
            [FromQuery] string? l9 = null,
            [FromQuery] string? l10 = null,
            [FromQuery] string? l11 = null,
            [FromQuery] string? l12 = null,
            [FromQuery] string? l13 = null,
            [FromQuery] string? l15 = null,
            [FromQuery] string? atualizado = null
        )
        {
            var statuses = new Dictionary<int, string?>
            {
                { 1, l1 },
                { 2, l2 },
                { 3, l3 },
                { 4, l4 },
                { 5, l5 },
                { 7, l7 },
                { 8, l8 },
                { 9, l9 },
                { 10, l10 },
                { 11, l11 },
                { 12, l12 },
                { 13, l13 },
                { 15, l15 }
            };

            var mapImageHref = GetEmbeddedMapImageHref();
            var svg = BuildSvg(statuses, atualizado ?? "tempo real", mapImageHref);

            return Content(svg, "image/svg+xml", Encoding.UTF8);
        }

        private string BuildSvg(Dictionary<int, string?> statuses, string atualizado, string mapImageHref)
        {
            var sb = new StringBuilder();

            sb.AppendLine($"""
<svg xmlns="http://www.w3.org/2000/svg" width="{Width}" height="{Height}" viewBox="0 0 {Width} {Height}">
  <rect width="100%" height="100%" fill="#f5f5f5"/>
  <image href="{EscapeXml(mapImageHref)}" x="0" y="0" width="{Width}" height="{Height}" preserveAspectRatio="xMidYMid meet"/>
""");

            foreach (var kv in Markers.OrderBy(x => x.Key))
            {
                var codigo = kv.Key;
                var marker = kv.Value;

                var situacao = statuses.TryGetValue(codigo, out var s) && !string.IsNullOrWhiteSpace(s)
                    ? s!
                    : "sem info";

                var color = ColorFromSituacao(situacao);

                sb.AppendLine($"""
  <circle cx="{marker.X}" cy="{marker.Y}" r="15" fill="white" opacity="0.95"/>
  <circle cx="{marker.X}" cy="{marker.Y}" r="11" fill="{color}" stroke="#111827" stroke-width="2"/>
""");
            }

            sb.AppendLine($"""
  <rect x="20" y="20" width="360" height="130" rx="18" fill="white" opacity="0.92"/>
  <text x="40" y="55" font-size="28" font-family="Arial, sans-serif" font-weight="700" fill="#111827">
    GeoSampa Alertas
  </text>
  <text x="40" y="85" font-size="22" font-family="Arial, sans-serif" fill="#374151">
    Mobilidade sobre trilhos
  </text>
  <text x="40" y="115" font-size="18" font-family="Arial, sans-serif" fill="#4b5563">
    Atualização: {EscapeXml(atualizado)}
  </text>

  <rect x="20" y="{Height - 130}" width="330" height="92" rx="16" fill="white" opacity="0.92"/>
  <circle cx="45" cy="{Height - 95}" r="10" fill="#22c55e" stroke="#111827" stroke-width="1.5"/>
  <text x="65" y="{Height - 88}" font-size="18" font-family="Arial, sans-serif" fill="#111827">Op. Normal</text>

  <circle cx="45" cy="{Height - 65}" r="10" fill="#facc15" stroke="#111827" stroke-width="1.5"/>
  <text x="65" y="{Height - 58}" font-size="18" font-family="Arial, sans-serif" fill="#111827">Atenção</text>

  <circle cx="185" cy="{Height - 95}" r="10" fill="#ef4444" stroke="#111827" stroke-width="1.5"/>
  <text x="205" y="{Height - 88}" font-size="18" font-family="Arial, sans-serif" fill="#111827">Interrompida</text>

  <circle cx="185" cy="{Height - 65}" r="10" fill="#9ca3af" stroke="#111827" stroke-width="1.5"/>
  <text x="205" y="{Height - 58}" font-size="18" font-family="Arial, sans-serif" fill="#111827">Sem info.</text>
</svg>
""");

            return sb.ToString();
        }

        private string GetEmbeddedMapImageHref()
        {
            var possibleFiles = new[]
            {
                Path.Combine(_environment.WebRootPath ?? string.Empty, "maps", "mapa.jpeg"),
                Path.Combine(_environment.WebRootPath ?? string.Empty, "maps", "mapa.jpg"),
                Path.Combine(_environment.WebRootPath ?? string.Empty, "maps", "mapa.png")
            };

            var filePath = possibleFiles.FirstOrDefault(System.IO.File.Exists);

            if (string.IsNullOrWhiteSpace(filePath))
            {
                throw new FileNotFoundException(
                    "Mapa base não encontrado. Coloque o arquivo em wwwroot/maps/mapa.jpeg, mapa.jpg ou mapa.png.");
            }

            var extension = Path.GetExtension(filePath).ToLowerInvariant();
            var mimeType = extension switch
            {
                ".jpg" => "image/jpeg",
                ".jpeg" => "image/jpeg",
                ".png" => "image/png",
                _ => "application/octet-stream"
            };

            var bytes = System.IO.File.ReadAllBytes(filePath);
            var base64 = Convert.ToBase64String(bytes);

            return $"data:{mimeType};base64,{base64}";
        }

        private static string ColorFromSituacao(string? situacao)
        {
            var s = Normalize(situacao);

            if (s.Contains("normal"))
                return "#22c55e";

            if (s.Contains("parcial") || s.Contains("reduz") || s.Contains("lent") || s.Contains("alter") || s.Contains("atras"))
                return "#facc15";

            if (s.Contains("interromp") || s.Contains("paralis") || s.Contains("suspens") || s.Contains("encerr"))
                return "#ef4444";

            return "#9ca3af";
        }

        private static string Normalize(string? value)
        {
            if (string.IsNullOrWhiteSpace(value))
                return string.Empty;

            var normalized = value.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
            var sb = new StringBuilder();

            foreach (var c in normalized)
            {
                var unicodeCategory = CharUnicodeInfo.GetUnicodeCategory(c);
                if (unicodeCategory != UnicodeCategory.NonSpacingMark)
                    sb.Append(c);
            }

            return sb.ToString().Normalize(NormalizationForm.FormC);
        }

        private static string EscapeXml(string? value)
        {
            return System.Security.SecurityElement.Escape(value ?? string.Empty) ?? string.Empty;
        }
    }
}