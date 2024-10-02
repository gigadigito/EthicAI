// Services/PreSaleService.cs
using System;
using System.Threading.Tasks;
using DAL;
using EthicAI.Data;
using EthicAI.EntityModel;
using Microsoft.Extensions.Configuration;


namespace EthicAI.Services
{
    public interface IPreSaleService
    {
        decimal GetConversionRate();
        decimal GetCorrectionValue();
        Task<decimal> CalculateEthicAIAmountAsync(decimal solAmount);
        Task<bool> ProcessPurchaseAsync(int userId, decimal solAmount, string transactionHash);
    }
}
namespace EthicAI.Services
{
    public class PreSaleService : IPreSaleService
    {
        private readonly EthicAIDbContext _context;
        private readonly IConfiguration _configuration;

        public PreSaleService(EthicAIDbContext context, IConfiguration configuration)
        {
            _context = context;
            _configuration = configuration;
        }

        // Obtém a taxa de conversão a partir das configurações
        public decimal GetConversionRate()
        {
            var rate = _configuration.GetValue<decimal>("PreSale:ConversionRate");
            return rate;
        }

        // Obtém o valor de correção a partir das configurações
        public decimal GetCorrectionValue()
        {
            var correction = _configuration.GetValue<decimal>("PreSale:CorrectionValue");
            return correction;
        }

        public async Task<decimal> CalculateEthicAIAmountAsync(decimal solAmount)
        {
            decimal conversionRate = GetConversionRate();
           
            decimal correctionValue = GetCorrectionValue();

            // Exemplo de cálculo: EthicAI = SOL * taxa de conversão + correção
            decimal ethicAIAmt = (solAmount * conversionRate) + correctionValue;

            // Aqui você pode adicionar lógica adicional, como verificar limites, etc.
            return ethicAIAmt;
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
           
            var result = await _context.SaveChangesAsync();

            return result > 0;
        }
    }
}
