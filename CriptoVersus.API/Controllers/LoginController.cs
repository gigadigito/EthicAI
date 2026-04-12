using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.RegularExpressions;
using Chaos.NaCl;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.IdentityModel.Tokens;
using Solnet.Wallet.Utilities;

namespace CriptoVersus.API.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class LoginController : ControllerBase
    {
        private readonly IMemoryCache _cache;
        private readonly IConfiguration _configuration;
        private readonly ILogger<LoginController> _logger;

        public LoginController(
            IMemoryCache cache,
            IConfiguration configuration,
            ILogger<LoginController> logger)
        {
            _cache = cache;
            _configuration = configuration;
            _logger = logger;
        }

        [HttpGet("solana/nonce")]
        public IActionResult GetSolanaNonce([FromQuery] string publicKey)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(publicKey))
                    return BadRequest(new { message = "PublicKey é obrigatória." });

                var nonce = Guid.NewGuid().ToString("N");
                var cacheKey = GetNonceCacheKey(publicKey);

                _cache.Set(cacheKey, nonce, TimeSpan.FromMinutes(5));

                var message = BuildLoginMessage(publicKey, nonce);

                _logger.LogInformation("Nonce gerado para wallet {Wallet}", publicKey);

                return Ok(new
                {
                    publicKey,
                    nonce,
                    expiresInMinutes = 5,
                    message
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Erro ao gerar nonce para login Solana.");
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    message = "Erro interno ao gerar nonce.",
                    detail = ex.Message
                });
            }
        }

        [HttpPost("solana")]
        public IActionResult SolanaLogin([FromBody] SolanaLoginRequest request)
        {
            try
            {
                if (request == null)
                    return BadRequest(new { message = "Payload inválido." });

                if (string.IsNullOrWhiteSpace(request.PublicKey) ||
                    string.IsNullOrWhiteSpace(request.Message) ||
                    string.IsNullOrWhiteSpace(request.Signature))
                {
                    return BadRequest(new
                    {
                        message = "PublicKey, Message e Signature são obrigatórios."
                    });
                }

                var extractedWallet = ExtractWalletFromMessage(request.Message);
                if (string.IsNullOrWhiteSpace(extractedWallet))
                {
                    return BadRequest(new
                    {
                        message = "A mensagem assinada não contém a wallet."
                    });
                }

                if (!string.Equals(extractedWallet, request.PublicKey, StringComparison.Ordinal))
                {
                    return BadRequest(new
                    {
                        message = "A wallet da mensagem não confere com a PublicKey enviada."
                    });
                }

                var extractedNonce = ExtractNonceFromMessage(request.Message);
                if (string.IsNullOrWhiteSpace(extractedNonce))
                {
                    return BadRequest(new
                    {
                        message = "A mensagem assinada não contém o nonce."
                    });
                }

                var cacheKey = GetNonceCacheKey(request.PublicKey);

                if (!_cache.TryGetValue(cacheKey, out string? expectedNonce) || string.IsNullOrWhiteSpace(expectedNonce))
                {
                    return Unauthorized(new
                    {
                        message = "Nonce expirado ou inexistente."
                    });
                }

                if (!string.Equals(expectedNonce, extractedNonce, StringComparison.Ordinal))
                {
                    return Unauthorized(new
                    {
                        message = "Nonce inválido."
                    });
                }

                var signatureIsValid = VerifySolanaSignature(
                    request.PublicKey,
                    request.Message,
                    request.Signature);

                if (!signatureIsValid)
                {
                    return Unauthorized(new
                    {
                        message = "Assinatura inválida."
                    });
                }

                _cache.Remove(cacheKey);

                var token = GenerateJwtToken(request.PublicKey);

                _logger.LogInformation("Login Solana realizado com sucesso para wallet {Wallet}", request.PublicKey);

                return Ok(new SolanaLoginResponse
                {
                    Token = token,
                    PublicKey = request.PublicKey,
                    ExpiresInMinutes = GetJwtExpirationMinutes()
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Erro interno ao realizar login Solana.");

                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    message = "Erro interno ao realizar login Solana.",
                    detail = ex.Message
                });
            }
        }

        private static string BuildLoginMessage(string publicKey, string nonce)
        {
            return $"Login CriptoVersus\nWallet: {publicKey}\nNonce: {nonce}";
        }

        private static string GetNonceCacheKey(string publicKey)
        {
            return $"solana_login_nonce:{publicKey}";
        }

        private static string? ExtractWalletFromMessage(string message)
        {
            var match = Regex.Match(
                message,
                @"Wallet:\s*(.+)",
                RegexOptions.IgnoreCase);

            return match.Success
                ? match.Groups[1].Value.Trim()
                : null;
        }

        private static string? ExtractNonceFromMessage(string message)
        {
            var match = Regex.Match(
                message,
                @"Nonce:\s*([A-Za-z0-9]+)",
                RegexOptions.IgnoreCase);

            return match.Success
                ? match.Groups[1].Value.Trim()
                : null;
        }

        private static bool VerifySolanaSignature(
            string publicKeyBase58,
            string message,
            string signatureBase64)
        {
            try
            {
                var publicKeyBytes = Encoders.Base58.DecodeData(publicKeyBase58);
                var signatureBytes = Convert.FromBase64String(signatureBase64);
                var messageBytes = Encoding.UTF8.GetBytes(message);

                return Ed25519.Verify(signatureBytes, messageBytes, publicKeyBytes);
            }
            catch
            {
                return false;
            }
        }

        private string GenerateJwtToken(string publicKey)
        {
            var jwtKey = _configuration["Jwt:Key"];
            var jwtIssuer = _configuration["Jwt:Issuer"];
            var jwtAudience = _configuration["Jwt:Audience"];
            var expiresMinutes = GetJwtExpirationMinutes();

            if (string.IsNullOrWhiteSpace(jwtKey))
                throw new InvalidOperationException("Jwt:Key não configurado.");

            var claims = new List<Claim>
            {
                new(JwtRegisteredClaimNames.Sub, publicKey),
                new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
                new(ClaimTypes.NameIdentifier, publicKey),
                new("wallet", publicKey),
                new("auth_type", "solana")
            };

            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));
            var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

            var token = new JwtSecurityToken(
                issuer: jwtIssuer,
                audience: jwtAudience,
                claims: claims,
                expires: DateTime.UtcNow.AddMinutes(expiresMinutes),
                signingCredentials: creds);

            return new JwtSecurityTokenHandler().WriteToken(token);
        }

        private int GetJwtExpirationMinutes()
        {
            var configured = _configuration["Jwt:ExpiresMinutes"];

            return int.TryParse(configured, out var minutes) && minutes > 0
                ? minutes
                : 120;
        }
    }

    public sealed class SolanaLoginRequest
    {
        public string PublicKey { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
        public string Signature { get; set; } = string.Empty;
    }

    public sealed class SolanaLoginResponse
    {
        public string Token { get; set; } = string.Empty;
        public string PublicKey { get; set; } = string.Empty;
        public int ExpiresInMinutes { get; set; }
    }
}