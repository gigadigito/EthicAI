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
            try
            {
                string endpoint = "https://api.binance.com/api/v3/ticker/24hr";
                string responseContent = await _httpClient.GetStringAsync(endpoint);

                // Logar a resposta para depuração
                Console.WriteLine("Resposta da Binance:");
                Console.WriteLine(responseContent);

                return JsonSerializer.Deserialize<List<Crypto>>(responseContent);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Erro ao obter dados da Binance: {ex.Message}");
                return new List<Crypto>();
            }
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
            [JsonPropertyName("symbol")]
            public string Symbol { get; set; }

            [JsonPropertyName("lastPrice")]
            public string LastPrice { get; set; }

            [JsonPropertyName("priceChangePercent")]
            public string PriceChangePercent { get; set; }
        }


    }
}
