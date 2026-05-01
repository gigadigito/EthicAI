using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace DAL.NftFutebol;

[Table("financial_migration_batch")]
public class FinancialMigrationBatch
{
    [Key]
    [Column("id")]
    public long Id { get; set; }

    [Required]
    [Column("from_mode")]
    [StringLength(50)]
    public string FromMode { get; set; } = string.Empty;

    [Required]
    [Column("to_mode")]
    [StringLength(50)]
    public string ToMode { get; set; } = string.Empty;

    [Column("total_users")]
    public int TotalUsers { get; set; }

    [Column("total_available_balance", TypeName = "numeric(18,8)")]
    public decimal TotalAvailableBalance { get; set; }

    [Column("total_locked_balance", TypeName = "numeric(18,8)")]
    public decimal TotalLockedBalance { get; set; }

    [Column("total_system_balance", TypeName = "numeric(18,8)")]
    public decimal TotalSystemBalance { get; set; }

    [Column("ledger_last_id")]
    public int LedgerLastId { get; set; }

    [Required]
    [Column("batch_hash")]
    [StringLength(128)]
    public string BatchHash { get; set; } = string.Empty;

    [Required]
    [Column("status")]
    [StringLength(30)]
    public string Status { get; set; } = string.Empty;

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [Column("completed_at")]
    public DateTime? CompletedAt { get; set; }

    public ICollection<FundMigrationCheckpoint> Checkpoints { get; set; } = new List<FundMigrationCheckpoint>();
}
