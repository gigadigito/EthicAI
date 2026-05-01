using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace DAL.NftFutebol;

[Table("fund_migration_checkpoint")]
public class FundMigrationCheckpoint
{
    [Key]
    [Column("id")]
    public long Id { get; set; }

    [Column("batch_id")]
    public long BatchId { get; set; }

    [Required]
    [Column("tx_wallet")]
    [StringLength(50)]
    public string TxWallet { get; set; } = string.Empty;

    [Required]
    [Column("old_mode")]
    [StringLength(50)]
    public string OldMode { get; set; } = string.Empty;

    [Required]
    [Column("new_mode")]
    [StringLength(50)]
    public string NewMode { get; set; } = string.Empty;

    [Column("balance_before", TypeName = "numeric(18,8)")]
    public decimal BalanceBefore { get; set; }

    [Column("locked_balance_before", TypeName = "numeric(18,8)")]
    public decimal LockedBalanceBefore { get; set; }

    [Column("system_balance_before", TypeName = "numeric(18,8)")]
    public decimal SystemBalanceBefore { get; set; }

    [Column("ledger_last_id")]
    public int LedgerLastId { get; set; }

    [Required]
    [Column("migration_hash")]
    [StringLength(128)]
    public string MigrationHash { get; set; } = string.Empty;

    [Required]
    [Column("status")]
    [StringLength(30)]
    public string Status { get; set; } = string.Empty;

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [Column("completed_at")]
    public DateTime? CompletedAt { get; set; }

    public FinancialMigrationBatch? Batch { get; set; }
}
