using Microsoft.AspNetCore.Mvc;
using System.Net;

namespace CriptoVersus.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class IconsController : ControllerBase
    {
        private static readonly HttpClient _http = new(new HttpClientHandler
        {
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate
        });

        // GET /api/icons/binance/ZEC
        [HttpGet("binance/{symbol}")]
        public async Task<IActionResult> GetBinanceIcon(string symbol, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(symbol))
                return BadRequest();

            symbol = new string(symbol.Trim().ToUpperInvariant()
                .Where(char.IsLetterOrDigit).ToArray());

            if (symbol.Length == 0 || symbol.Length > 20)
                return BadRequest();

            var url = $"https://bin.bnbstatic.com/static/assets/logos/{symbol}.png";

            using var req = new HttpRequestMessage(HttpMethod.Get, url);

            // headers que aumentam chance de passar em CDNs
            req.Headers.UserAgent.ParseAdd("Mozilla/5.0");
            req.Headers.Accept.ParseAdd("image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
            req.Headers.Referrer = new Uri("https://www.binance.com/");

            using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);

            if (!resp.IsSuccessStatusCode)
                return StatusCode((int)resp.StatusCode);

            var contentType = resp.Content.Headers.ContentType?.ToString() ?? "image/png";
            var bytes = await resp.Content.ReadAsByteArrayAsync(ct);

            // cache no browser por 7 dias
            Response.Headers.CacheControl = "public,max-age=604800";

            return File(bytes, contentType);
        }
    }
}
