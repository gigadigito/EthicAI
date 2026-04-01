using System.Threading;
using System.Threading.Tasks;
using DAL.NftFutebol;
using DAL;
using EthicAI.EntityModel;

namespace BLL
{
    public interface ILedgerService
    {
        Task<Ledger> AddEntryAsync(
            User user,
            string type,
            decimal amount,
            decimal balanceBefore,
            decimal balanceAfter,
            int? referenceId = null,
            string? description = null,
            CancellationToken ct = default);
    }

    public class LedgerService : ILedgerService
    {
        private readonly EthicAIDbContext _db;

        public LedgerService(EthicAIDbContext db)
        {
            _db = db;
        }

        public async Task<Ledger> AddEntryAsync(
            User user,
            string type,
            decimal amount,
            decimal balanceBefore,
            decimal balanceAfter,
            int? referenceId = null,
            string? description = null,
            CancellationToken ct = default)
        {
            if (user == null)
                throw new ArgumentNullException(nameof(user));

            if (string.IsNullOrWhiteSpace(type))
                throw new ArgumentException("Ledger type is required.", nameof(type));

            var entry = new Ledger
            {
                UserId = user.UserID,
                Type = type.Trim().ToUpperInvariant(),
                Amount = RoundMoney(amount),
                BalanceBefore = RoundMoney(balanceBefore),
                BalanceAfter = RoundMoney(balanceAfter),
                CreatedAt = DateTime.UtcNow,
                ReferenceId = referenceId,
                Description = description
            };

            _db.Set<Ledger>().Add(entry);
            await _db.SaveChangesAsync(ct);

            return entry;
        }

        private static decimal RoundMoney(decimal value)
            => Math.Round(value, 8, MidpointRounding.ToZero);
    }
}