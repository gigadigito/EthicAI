using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations.Schema;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DAL.NftFutebol
{
    [Table("ledger")]
    public class Ledger
    {
        [Key]
        [Column("id")]
        public int Id { get; set; }

        [Column("cd_user")]
        public int UserId { get; set; }

        [Required]
        [Column("tx_type")]
        [StringLength(20)]
        public string Type { get; set; } = string.Empty;

        [Column("nr_amount", TypeName = "numeric(18,8)")]
        public decimal Amount { get; set; }

        [Column("nr_balance_before", TypeName = "numeric(18,8)")]
        public decimal BalanceBefore { get; set; }

        [Column("nr_balance_after", TypeName = "numeric(18,8)")]
        public decimal BalanceAfter { get; set; }

        [Column("dt_created")]
        public DateTime CreatedAt { get; set; }

        [Column("reference_id")]
        public int? ReferenceId { get; set; }

        [Column("tx_description")]
        public string? Description { get; set; }
    }
}
