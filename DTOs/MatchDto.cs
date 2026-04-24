using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DTOs
{

    public class MatchDto
    {
        public int MatchId { get; set; }

        // Times
        public string TeamA { get; set; } = string.Empty;
        public string TeamB { get; set; } = string.Empty;


        public int TeamAId { get; set; }
        public int TeamBId { get; set; }
        // Placares
        public int ScoreA { get; set; }
        public int ScoreB { get; set; }

        // Status
        public string Status { get; set; } = string.Empty;

        // Tempo
        public DateTime? StartTime { get; set; }
        public DateTime? EndTime { get; set; }

        public DateTimeOffset? BettingCloseTime { get; set; }

        // Auxiliares para UI
        public int ElapsedMinutes { get; set; }
        public int RemainingMinutes { get; set; }
        public bool IsFinished { get; set; }


        // ✅ NOVO: % atual de cada moeda
    public decimal? PctA { get; set; }
    public decimal? PctB { get; set; }
    public decimal? QuoteVolumeA { get; set; }
    public decimal? QuoteVolumeB { get; set; }
    public string ScoringRuleType { get; set; } = string.Empty;
    public int? WinnerTeamId { get; set; }
    public string? WinnerTeamSymbol { get; set; }
    public string? EndReasonCode { get; set; }
    public string? EndReasonDetail { get; set; }
    public decimal TotalAmountTeamA { get; set; }
    public decimal TotalAmountTeamB { get; set; }
    public int WalletCountTeamA { get; set; }
    public int WalletCountTeamB { get; set; }
    public int BetCountTeamA { get; set; }
    public int BetCountTeamB { get; set; }
    public decimal TotalPool { get; set; }
    public decimal LosingPool { get; set; }
    public decimal WinningPool { get; set; }
    public decimal HouseFeeAmount { get; set; }
    public decimal TotalDistributed { get; set; }
    public bool HasBetsOnBothSides { get; set; }
    public bool HasValidFinancialDispute { get; set; }
    public List<MatchParticipantDto> Participants { get; set; } = [];
    }



}
