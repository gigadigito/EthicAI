using System.Collections.Generic;
using System.Linq;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using DAL;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace EthicAI.Services
{
    public interface IPreSaleService
    {
        decimal GetConversionRate();
        decimal GetCorrectionValue();
        Task<decimal> CalculateEthicAIAmountAsync(decimal solAmount);
        Task<bool> ProcessPurchaseAsync(int userId, decimal solAmount, string transactionHash);
        Task<List<PreSalePurchase>> GetPurchasesByWalletAsync(string wallet);

        Task<decimal> GetTotalRaisedUSDAsync(); // Adicione esta linha
    }

    public class PreSaleService : IPreSaleService
    {
        private readonly EthicAIDbContext _context;
        private readonly IConfiguration _configuration;

        public PreSaleService(EthicAIDbContext context, IConfiguration configuration)
        {
            _context = context;
            _configuration = configuration;
        }

        public decimal GetConversionRate()
        {
            return _configuration.GetValue<decimal>("PreSale:ConversionRate");
        }

        public decimal GetCorrectionValue()
        {
            return _configuration.GetValue<decimal>("PreSale:CorrectionValue");
        }

        public async Task<decimal> CalculateEthicAIAmountAsync(decimal solAmount)
        {
            decimal conversionRate = GetConversionRate();
            decimal correctionValue = GetCorrectionValue();
            return (solAmount * conversionRate) + correctionValue;
        }
        public async Task<decimal> GetSolanaPriceInUSD()
        {
            try
            {
                using var httpClient = new HttpClient();
                var response = await httpClient.GetAsync("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
                response.EnsureSuccessStatusCode();
                var result = await response.Content.ReadFromJsonAsync<JsonElement>();

                return result.GetProperty("solana").GetProperty("usd").GetDecimal();
            }
            catch
            {
                // Retornar 0 caso a API falhe (pode adicionar logging para monitorar esses casos)
                return 0;
            }
        }

        public async Task<decimal> GetTotalRaisedUSDAsync()
        {
            var totalSolRaised = await _context.PreSalePurchase.SumAsync(p => p.SolAmount);
            var solToUSD = await GetSolanaPriceInUSD(); // Pega o preço atual do SOL em USD
            return totalSolRaised * solToUSD;
        }

        public async Task<bool> ProcessPurchaseAsync(int userId, decimal solAmount, string transactionHash)
        {
            if (solAmount <= 0)
                throw new ArgumentException("A quantidade de SOL deve ser maior que zero.");

            decimal ethicAIAmt = await CalculateEthicAIAmountAsync(solAmount);

            var purchase = new PreSalePurchase
            {
                UserId = userId,
                SolAmount = solAmount,
                EthicAIAmt = ethicAIAmt,
                PurchaseDate = DateTime.UtcNow,
                TransactionHash = transactionHash
            };

            _context.PreSalePurchase.Add(purchase);
            return await _context.SaveChangesAsync() > 0;
        }

        // Novo método para listar compras com base na carteira do usuário
        public async Task<List<PreSalePurchase>> GetPurchasesByWalletAsync(string wallet)
        {
            var user = await _context.User.FirstOrDefaultAsync(u => u.Wallet == wallet);

            if (user == null)
                return new List<PreSalePurchase>();

            return await _context.PreSalePurchase
                .Where(p => p.UserId == user.UserID)
                .OrderByDescending(p => p.PurchaseDate)
                .ToListAsync();
        }
    }
}
