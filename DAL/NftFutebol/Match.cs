using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DAL.NftFutebol
{
    public class Match
    {
        public int MatchId { get; set; }
        public DateTime? StartTime { get; set; }
        public DateTime? EndTime { get; set; }
        public int TeamAId { get; set; }
        public int TeamBId { get; set; }
        public Team TeamA { get; set; }
        public Team TeamB { get; set; }
        public int ScoreA { get; set; }
        public int ScoreB { get; set; }
        public MatchStatus Status { get; set; }
        public ICollection<Bet> Bets { get; set; }
    }
}
public enum MatchStatus
{
    Pending,    // Partida pendente, aguardando início
    Ongoing,    // Partida em andamento
    Completed   // Partida concluída
}