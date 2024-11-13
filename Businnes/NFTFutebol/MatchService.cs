﻿using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using static BLL.BinanceService;

namespace BLL.NFTFutebol
{
    public class MatchService
    {
        private readonly EthicAIDbContext _context;

        public MatchService(EthicAIDbContext context)
        {
            _context = context;
        }
        // Método para criar 3 partidas com as moedas salvas no banco de dados
        public async Task<List<Match>> CreateMatchesAsync(List<Currency> currencies)
        {
            var matches = new List<Match>();

            for (int i = 0; i < 3; i++)
            {
                var currencyA = currencies[i * 2];
                var currencyB = currencies[i * 2 + 1];

                // Criar times para as moedas
                var teamA = new Team { CurrencyId = currencyA.CurrencyId };
                var teamB = new Team { CurrencyId = currencyB.CurrencyId };

                _context.Team.AddRange(teamA, teamB);
                await _context.SaveChangesAsync(); // Salva para obter os IDs dos times

                // Calcular o placar com base na porcentagem de mudança
                int scoreA = (int)Math.Floor(currencyA.PercentageChange / 10);
                int scoreB = (int)Math.Floor(currencyB.PercentageChange / 10);

                // Criar a partida com os times e o placar calculado
                var match = new Match
                {
                    TeamAId = teamA.TeamId,
                    TeamBId = teamB.TeamId,
                    StartTime = DateTime.UtcNow,
                    Status = MatchStatus.Pending,
                    ScoreA = scoreA,
                    ScoreB = scoreB
                };

                _context.Match.Add(match);
                await _context.SaveChangesAsync(); // Salva para obter o ID da partida

                // Carregar as propriedades de navegação
                _context.Entry(teamA).Reference(t => t.Currency).Load();
                _context.Entry(teamB).Reference(t => t.Currency).Load();

                match.TeamA = teamA;
                match.TeamB = teamB;

                matches.Add(match);
            }

            return matches;
        }

        // Método para buscar o jogo com os times especificados
        public async Task<Match> GetMatchByTeamsAsync(string teamASymbol, string teamBSymbol)
        {
            return await _context.Match
                .Include(m => m.TeamA).ThenInclude(t => t.Currency)
                .Include(m => m.TeamB).ThenInclude(t => t.Currency)
                .FirstOrDefaultAsync(m => m.TeamA.Currency.Symbol.ToLower() == teamASymbol &&
                                          m.TeamB.Currency.Symbol.ToLower() == teamBSymbol);
        }

        // Método para registrar a aposta
        public async Task<bool> PlaceBetAsync(int matchId, int teamId, decimal amount)
        {
            try
            {
                var bet = new Bet
                {
                    MatchId = matchId,
                    TeamId = teamId,
                    Amount = amount,
                    BetTime = DateTime.UtcNow
                };
                _context.Bet.Add(bet);
                await _context.SaveChangesAsync();
                return true;
            }
            catch
            {
                return false;
            }
        }


        // Método para buscar as próximas 3 partidas pendentes
        public async Task<List<Match>> GetUpcomingPendingMatchesAsync(int count)
        {
            return await _context.Match
                .Where(m => m.Status == MatchStatus.Pending)
                .OrderBy(m => m.StartTime) // Ordena pela data de início mais próxima
                .Take(count)
                .Include(m => m.TeamA).ThenInclude(t => t.Currency)
                .Include(m => m.TeamB).ThenInclude(t => t.Currency)
                .ToListAsync();
        }
        // Método para buscar as três partidas mais recentes
        public async Task<List<Match>> GetRecentMatchesAsync(int count)
        {
            return await _context.Match
                .OrderByDescending(m => m.StartTime)
                .Take(count)
                .Include(m => m.TeamA).ThenInclude(t => t.Currency)
                .Include(m => m.TeamB).ThenInclude(t => t.Currency)
                .ToListAsync();
        }
        // Método para salvar ou atualizar moedas e retornar instâncias com IDs válidos
        public async Task<List<Currency>> SaveCurrenciesAsync(List<Crypto> topGainers)
        {
            var currencies = new List<Currency>();

            foreach (var crypto in topGainers)
            {
                var currency = await _context.Currency.FirstOrDefaultAsync(c => c.Symbol == crypto.Symbol);
                if (currency == null)
                {
                    currency = new Currency
                    {
                        Name = crypto.Symbol.Replace("USDT", ""),
                        Symbol = crypto.Symbol,
                        PercentageChange = decimal.TryParse(crypto.PriceChangePercent, NumberStyles.Any, CultureInfo.InvariantCulture, out var percent) ? (double)percent : 0,
                        LastUpdated = DateTime.UtcNow
                    };
                    _context.Currency.Add(currency);
                }
                else
                {
                    currency.PercentageChange = decimal.TryParse(crypto.PriceChangePercent, NumberStyles.Any, CultureInfo.InvariantCulture, out var percent) ? (double)percent : 0;
                    currency.LastUpdated = DateTime.UtcNow;
                    _context.Currency.Update(currency);
                }

                currencies.Add(currency);
            }

            await _context.SaveChangesAsync();
            return currencies;
        }
        // Método para criar uma nova partida
        public async Task<Match> CreateMatchAsync(Currency currencyA, Currency currencyB)
        {
            // Cria os times com as moedas correspondentes
            var teamA = new Team { CurrencyId = currencyA.CurrencyId };
            var teamB = new Team { CurrencyId = currencyB.CurrencyId };

            await _context.Team.AddRangeAsync(teamA, teamB);
            await _context.SaveChangesAsync();

            // Cria a partida com os times e define o status como pendente
            var match = new Match
            {
                TeamAId = teamA.TeamId,
                TeamBId = teamB.TeamId,
                StartTime = DateTime.UtcNow,
                Status = MatchStatus.Pending
            };

            await _context.Match.AddAsync(match);
            await _context.SaveChangesAsync();

            return match;
        }
        // Adicionar uma moeda
        public async Task AddCurrencyAsync(Currency currency)
        {
            _context.Currency.Add(currency);
            await _context.SaveChangesAsync();
        }

        // Obter moeda por símbolo
        public async Task<Currency> GetCurrencyBySymbolAsync(string symbol)
        {
            return await _context.Currency.FirstOrDefaultAsync(c => c.Symbol == symbol);
        }

        // Atualizar moeda
        public async Task UpdateCurrencyAsync(Currency currency)
        {
            _context.Currency.Update(currency);
            await _context.SaveChangesAsync();
        }
        // Método para iniciar uma partida
        public async Task StartMatchAsync(int matchId)
        {
            var match = await _context.Match.FindAsync(matchId);
            if (match == null)
                throw new Exception("Match not found.");

            match.Status = MatchStatus.Ongoing;
            await _context.SaveChangesAsync();
        }

        // Método para finalizar uma partida
        public async Task EndMatchAsync(int matchId)
        {
            var match = await _context.Match
                .Include(m => m.TeamA)
                    .ThenInclude(t => t.Currency)
                .Include(m => m.TeamB)
                    .ThenInclude(t => t.Currency)
                .Include(m => m.Bets)
                .FirstOrDefaultAsync(m => m.MatchId == matchId);

            if (match == null)
                throw new Exception("Match not found.");

            // Atualiza as cotações das moedas
            await UpdateCurrencyValuesAsync(match.TeamA.Currency);
            await UpdateCurrencyValuesAsync(match.TeamB.Currency);

            // Calcula o placar com base na valorização das moedas
            var valuationA = match.TeamA.Currency.PercentageChange;
            var valuationB = match.TeamB.Currency.PercentageChange;

            match.ScoreA = valuationA > valuationB ? (int)((valuationA - valuationB) / 10) : 0;
            match.ScoreB = valuationB > valuationA ? (int)((valuationB - valuationA) / 10) : 0;
            match.Status = MatchStatus.Completed;
            match.EndTime = DateTime.UtcNow;

            _context.Match.Update(match);
            await _context.SaveChangesAsync();

            // Paga os vencedores
            await PayoutWinnersAsync(match);
        }

        // Método para pagar os vencedores
        private async Task PayoutWinnersAsync(Match match)
        {
            // Calcula o valor total da pool e a taxa da casa
            var totalPool = match.Bets.Sum(b => b.Amount);
            var houseFee = totalPool * 0.05m; // 5% para a casa
            var payoutPool = totalPool - houseFee;

            // Determina o time vencedor
            int winningTeamId;
            if (match.ScoreA > match.ScoreB)
                winningTeamId = match.TeamAId;
            else if (match.ScoreB > match.ScoreA)
                winningTeamId = match.TeamBId;
            else
                winningTeamId = 0; // Empate

            if (winningTeamId == 0)
            {
                // Em caso de empate, as apostas podem ser retornadas ou tratadas conforme regra
                foreach (var bet in match.Bets)
                {
                    // Retorna o valor apostado ao jogador
                    Console.WriteLine($"Devolvendo {bet.Amount} ao jogador {bet.PlayerId}");
                    // Implementar lógica de devolução
                }
            }
            else
            {
                var winningBets = match.Bets.Where(b => b.TeamId == winningTeamId).ToList();
                var totalWinningBets = winningBets.Sum(b => b.Amount);

                foreach (var bet in winningBets)
                {
                    var payout = (bet.Amount / totalWinningBets) * payoutPool;

                    // Simulação de pagamento ao apostador
                    Console.WriteLine($"Pagando {payout} ao jogador {bet.PlayerId}");
                    // Implementar lógica de pagamento
                }
            }

            await _context.SaveChangesAsync();
        }

        // Método auxiliar para atualizar os valores das moedas
        private async Task UpdateCurrencyValuesAsync(Currency currency)
        {
            // Implementar lógica para atualizar 'PercentageChange' da moeda
            // Por exemplo, consumir API da Binance
            // Exemplo:
            // currency.PercentageChange = await _currencyService.GetPercentageChangeAsync(currency.Name);
            // currency.LastUpdated = DateTime.UtcNow;

            _context.Currency.Update(currency);
            await _context.SaveChangesAsync();
        }

        // Método para obter partidas em andamento
        public async Task<List<Match>> GetOngoingMatchesAsync()
        {
            return await _context.Match
                .Where(m => m.Status == MatchStatus.Ongoing)
                .Include(m => m.TeamA)
                    .ThenInclude(t => t.Currency)
                .Include(m => m.TeamB)
                    .ThenInclude(t => t.Currency)
                .ToListAsync();
        }
    }
}