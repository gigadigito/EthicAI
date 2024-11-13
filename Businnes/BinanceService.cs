using System;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;

namespace BLL
{
    public class BinanceService
    {
        private readonly HttpClient _httpClient;
        private readonly SecretManager _secretManager;
        private readonly string _apiKey;
        private readonly string _secretKey;

        public BinanceService(HttpClient httpClient, SecretManager secretManager)
        {
            _httpClient = httpClient;
            _secretManager = secretManager;
            _apiKey = _secretManager.GetSecret("BinanceApiKey");
            _secretKey = _secretManager.GetSecret("BinanceSecretKey");
        }
        public async Task<List<Crypto>> Get24HrTickerDataAsync()
        {
            string endpoint = "https://api.binance.com/api/v3/ticker/24hr";
            string responseContent = await _httpClient.GetStringAsync(endpoint);
            return JsonSerializer.Deserialize<List<Crypto>>(responseContent);
        }

        public async Task<string> GetAccountInfoAsync()
        {
            string endpoint = "https://api.binance.com/api/v3/account";
            long timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            string queryString = $"timestamp={timestamp}";

            // Gerar a assinatura usando a chave secreta
            string signature = GenerateSignature(queryString);
            string url = $"{endpoint}?{queryString}&signature={signature}";

            // Configurar o cabeçalho da API key
            _httpClient.DefaultRequestHeaders.Clear();
            _httpClient.DefaultRequestHeaders.Add("X-MBX-APIKEY", _apiKey);

            var response = await _httpClient.GetAsync(url);
            response.EnsureSuccessStatusCode();

            return await response.Content.ReadAsStringAsync();
        }

        private string GenerateSignature(string queryString)
        {
            using (var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(_secretKey)))
            {
                var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(queryString));
                return BitConverter.ToString(hash).Replace("-", "").ToLower();
            }
        }

        // Model class for response data
        public class Crypto
        {
            public string Symbol { get; set; }

            // Defina LastPrice e PriceChangePercent como strings para evitar problemas de conversão
            public string LastPrice { get; set; }
            public string PriceChangePercent { get; set; }
        }

    }
}
