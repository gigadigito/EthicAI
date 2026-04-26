using DAL;
using DAL.NftFutebol;
using DAL.Seed;
using Microsoft.EntityFrameworkCore;

namespace EthicAI.EntityModel
{
    public class EthicAIDbContext : DbContext
    {
        public EthicAIDbContext(DbContextOptions<EthicAIDbContext> options)
            : base(options)
        {
        }

        public DbSet<User> User { get; set; }
        public DbSet<PreSalePurchase> PreSalePurchase { get; set; }
        public DbSet<Post> Post { get; set; }

        public DbSet<Ledger> Ledger { get; set; }
        public DbSet<PostCategory> PostCategory { get; set; }
        public DbSet<Match> Match { get; set; }
        public DbSet<Team> Team { get; set; }
        public DbSet<Currency> Currency { get; set; }
        public DbSet<Bet> Bet { get; set; }
        public DbSet<UserTeamPosition> UserTeamPosition { get; set; }
        public DbSet<WorkerStatus> WorkerStatus { get; set; }
        public DbSet<MatchMetricSnapshot> MatchMetricSnapshot { get; set; }
        public DbSet<MatchScoreEvent> MatchScoreEvent { get; set; }
        public DbSet<MatchScoreState> MatchScoreState { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<WorkerStatus>(entity =>
            {
                entity.HasKey(e => e.WorkerName);
                entity.ToTable("worker_status");

                entity.Property(e => e.WorkerName)
                      .HasMaxLength(50)
                      .HasColumnName("tx_worker_name");

                entity.Property(e => e.LastHeartbeat)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_last_heartbeat");

                entity.Property(e => e.LastCycleStart)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_last_cycle_start");

                entity.Property(e => e.LastCycleEnd)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_last_cycle_end");

                entity.Property(e => e.LastSuccess)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_last_success");

                entity.Property(e => e.LastError)
                      .HasColumnName("tx_last_error");

                entity.Property(e => e.Status)
                      .HasMaxLength(20)
                      .HasColumnName("in_status");

                entity.Property(e => e.UpdatedAt)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_updated_at");
            });

            modelBuilder.Entity<User>(entity =>
            {
                entity.HasKey(e => e.UserID);
                entity.ToTable("user");

                entity.Property(e => e.UserID).HasColumnName("cd_user");
                entity.Property(e => e.Name).HasMaxLength(50).HasColumnName("nm_name");
                entity.Property(e => e.Email).HasMaxLength(254).HasColumnName("tx_email");
                entity.Property(e => e.Wallet).IsRequired().HasMaxLength(50).HasColumnName("tx_wallet");
                entity.Property(e => e.DtUpdate).HasColumnType("timestamp with time zone").HasColumnName("dt_update");
                entity.Property(e => e.IsHuman).HasColumnName("is_human");
                entity.Property(e => e.HumanCaptcha).HasMaxLength(100).HasColumnName("tx_human_captcha");
                entity.Property(e => e.DtHumanValidation).HasColumnType("timestamp with time zone").HasColumnName("dt_human_validation");
                entity.Property(e => e.LastLogin).HasColumnType("timestamp with time zone").HasColumnName("dt_last_login");
                entity.Property(e => e.IAName).HasMaxLength(100).HasColumnName("nm_ia");
                entity.Property(e => e.HumanRepresentative).HasMaxLength(100).HasColumnName("nm_human_representative");
                entity.Property(e => e.Company).HasMaxLength(100).HasColumnName("nm_company");
                entity.Property(e => e.IAModel).HasMaxLength(100).HasColumnName("nm_ia_model");
                entity.Property(e => e.DtCreate).HasColumnName("dt_create");

                entity.Property(e => e.Balance)
                      .HasColumnType("decimal(18, 8)")
                      .HasColumnName("nr_balance")
                      .HasDefaultValue(0m);

                entity.Property(e => e.TotalClaimed)
                      .HasColumnType("decimal(18, 8)")
                      .HasColumnName("nr_total_claimed")
                      .HasDefaultValue(0m);

                entity.Property(e => e.TotalWithdrawn)
                      .HasColumnType("decimal(18, 8)")
                      .HasColumnName("nr_total_withdrawn")
                      .HasDefaultValue(0m);

                entity.HasMany(e => e.TeamPositions)
                      .WithOne(p => p.User)
                      .HasForeignKey(p => p.UserId)
                      .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<PreSalePurchase>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.ToTable("pre_sale_purchase");

                entity.Property(e => e.Id).HasColumnName("id_purchase");
                entity.Property(e => e.UserId).IsRequired().HasColumnName("user_id");
                entity.Property(e => e.SolAmount).HasColumnType("decimal(18, 8)").HasColumnName("sol_amount");
                entity.Property(e => e.EthicAIAmt).HasColumnType("decimal(18, 8)").HasColumnName("ethic_ai_amount");
                entity.Property(e => e.PurchaseDate).HasColumnType("timestamp with time zone").HasColumnName("purchase_date");
                entity.Property(e => e.TransactionHash).HasMaxLength(100).HasColumnName("transaction_hash");

                entity.HasOne(e => e.User)
                      .WithMany(u => u.PreSalePurchases)
                      .HasForeignKey(e => e.UserId)
                      .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<Post>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.ToTable("post");

                entity.Property(e => e.Id).HasColumnName("id_post");
                entity.Property(e => e.Title).IsRequired().HasMaxLength(100).HasColumnName("tx_title");
                entity.Property(e => e.Content).IsRequired().HasColumnName("tx_content");
                entity.Property(e => e.Url).IsRequired().HasMaxLength(100).HasColumnName("tx_url");
                entity.Property(e => e.PostDate).HasColumnType("timestamp with time zone").HasColumnName("dt_post");
                entity.Property(e => e.Image).HasColumnType("bytea").HasColumnName("aq_image");
                entity.Property(e => e.PostCategoryId).HasColumnName("post_category_id");

                entity.HasOne(e => e.PostCategory)
                      .WithMany(c => c.Posts)
                      .HasForeignKey(e => e.PostCategoryId)
                      .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<PostCategory>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.ToTable("post_category");

                entity.Property(e => e.Id)
                      .HasColumnName("id_post_category")
                      .ValueGeneratedNever();

                entity.Property(e => e.Name)
                      .IsRequired()
                      .HasMaxLength(50)
                      .HasColumnName("tx_name");
            });

            modelBuilder.Entity<Match>(entity =>
            {
                entity.HasKey(e => e.MatchId);
                entity.ToTable("match");

                entity.Property(e => e.MatchId).HasColumnName("cd_match");
                entity.Property(e => e.StartTime).HasColumnType("timestamp with time zone").HasColumnName("dt_start_time");
                entity.Property(e => e.EndTime).HasColumnType("timestamp with time zone").HasColumnName("dt_end_time");

                entity.Property(e => e.BettingCloseTime)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_betting_close")
                      .IsRequired(false);

                entity.Property(e => e.ScoringRuleType)
                      .HasConversion<string>()
                      .HasColumnName("in_scoring_rule")
                      .HasMaxLength(40)
                      .HasDefaultValue(MatchScoringRuleType.PercentThreshold);

                entity.Property(e => e.TeamAId).HasColumnName("cd_team_a");
                entity.Property(e => e.TeamBId).HasColumnName("cd_team_b");

                entity.Property(e => e.ScoreA).HasColumnName("nr_score_a");
                entity.Property(e => e.ScoreB).HasColumnName("nr_score_b");

                entity.Property(e => e.Status)
                      .HasConversion<string>()
                      .HasColumnName("in_status");

                entity.Property(e => e.TeamAOutCycles)
                      .HasColumnName("nr_team_a_out_cycles")
                      .HasDefaultValue(0);

                entity.Property(e => e.TeamBOutCycles)
                      .HasColumnName("nr_team_b_out_cycles")
                      .HasDefaultValue(0);

                entity.Property(e => e.WinnerTeamId)
                      .HasColumnName("cd_winner_team")
                      .IsRequired(false);

                entity.Property(e => e.EndReasonCode)
                      .HasColumnName("tx_end_reason_code")
                      .HasMaxLength(80);

                entity.Property(e => e.EndReasonDetail)
                      .HasColumnName("tx_end_reason_detail");

                entity.Property(e => e.RulesetVersion)
                      .HasColumnName("tx_ruleset_version")
                      .HasMaxLength(20);

                entity.HasOne(e => e.TeamA)
                      .WithMany(t => t.MatchesAsTeamA)
                      .HasForeignKey(e => e.TeamAId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasOne(e => e.TeamB)
                      .WithMany(t => t.MatchesAsTeamB)
                      .HasForeignKey(e => e.TeamBId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasOne(e => e.WinnerTeam)
                      .WithMany()
                      .HasForeignKey(e => e.WinnerTeamId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasMany(e => e.Bets)
                      .WithOne(b => b.Match)
                      .HasForeignKey(b => b.MatchId)
                      .OnDelete(DeleteBehavior.Cascade);

                entity.HasOne(e => e.ScoreState)
                      .WithOne(s => s.Match)
                      .HasForeignKey<MatchScoreState>(s => s.MatchId)
                      .OnDelete(DeleteBehavior.Cascade);

                entity.HasMany(e => e.MetricSnapshots)
                      .WithOne(s => s.Match)
                      .HasForeignKey(s => s.MatchId)
                      .OnDelete(DeleteBehavior.Cascade);

                entity.HasMany(e => e.ScoreEvents)
                      .WithOne(e => e.Match)
                      .HasForeignKey(e => e.MatchId)
                      .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<Team>(entity =>
            {
                entity.HasKey(e => e.TeamId);
                entity.ToTable("team");

                entity.Property(e => e.TeamId).HasColumnName("cd_team");
                entity.Property(e => e.CurrencyId).HasColumnName("cd_currency");

                entity.HasOne(e => e.Currency)
                      .WithMany(c => c.Teams)
                      .HasForeignKey(e => e.CurrencyId)
                      .OnDelete(DeleteBehavior.Cascade);

                entity.HasMany(e => e.Bets)
                      .WithOne(b => b.Team)
                      .HasForeignKey(b => b.TeamId)
                      .OnDelete(DeleteBehavior.Cascade);

                entity.HasMany(e => e.UserPositions)
                      .WithOne(p => p.Team)
                      .HasForeignKey(p => p.TeamId)
                      .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<Currency>(entity =>
            {
                entity.HasKey(e => e.CurrencyId);
                entity.ToTable("currency");

                entity.Property(e => e.CurrencyId).HasColumnName("cd_currency");
                entity.Property(e => e.Name).IsRequired().HasMaxLength(50).HasColumnName("tx_name");
                entity.Property(e => e.Symbol).IsRequired().HasMaxLength(50).HasColumnName("tx_symbol");
                entity.Property(e => e.PercentageChange).HasColumnType("decimal(5, 2)").HasColumnName("nr_percentage_change");

                entity.Property(e => e.QuoteVolume)
                      .HasColumnType("decimal(28, 8)")
                      .HasColumnName("nr_quote_volume")
                      .HasDefaultValue(0m);

                entity.Property(e => e.TradesCount)
                      .HasColumnName("nr_trades_count")
                      .HasDefaultValue(0L);

                entity.Property(e => e.LastUpdated).HasColumnType("timestamp with time zone").HasColumnName("dt_last_updated");
            });

            modelBuilder.Entity<Bet>(entity =>
            {
                entity.HasKey(e => e.BetId);
                entity.ToTable("bet");

                entity.Property(e => e.BetId).HasColumnName("cd_bet");
                entity.Property(e => e.MatchId).HasColumnName("cd_match");
                entity.Property(e => e.TeamId).HasColumnName("cd_team");
                entity.Property(e => e.UserId).HasColumnName("cd_user");
                entity.Property(e => e.PositionId).HasColumnName("cd_position");

                entity.Property(e => e.Amount)
                      .HasColumnType("decimal(18, 8)")
                      .HasColumnName("nr_amount");

                entity.Property(e => e.BetTime)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_bet_time");

                entity.Property(e => e.Position)
                      .HasColumnName("nr_position");

                entity.Property(e => e.Claimed)
                      .HasColumnName("is_claimed")
                      .HasDefaultValue(false);

                entity.Property(e => e.ClaimedAt)
                      .HasColumnName("dt_claimed_at")
                      .HasColumnType("timestamp with time zone")
                      .IsRequired(false);

                entity.Property(e => e.IsWinner)
                      .HasColumnName("is_winner")
                      .IsRequired(false);

                entity.Property(e => e.PayoutAmount)
                      .HasColumnType("decimal(18, 8)")
                      .HasColumnName("nr_payout_amount")
                      .IsRequired(false);

                entity.Property(e => e.SettledAt)
                      .HasColumnName("dt_settled_at")
                      .HasColumnType("timestamp with time zone")
                      .IsRequired(false);

                entity.HasOne(e => e.Match)
                      .WithMany(m => m.Bets)
                      .HasForeignKey(b => b.MatchId)
                      .OnDelete(DeleteBehavior.Cascade);

                entity.HasOne(e => e.Team)
                      .WithMany(t => t.Bets)
                      .HasForeignKey(b => b.TeamId)
                      .OnDelete(DeleteBehavior.Cascade);

                entity.HasOne(e => e.User)
                      .WithMany(u => u.Bets)
                      .HasForeignKey(b => b.UserId)
                      .OnDelete(DeleteBehavior.Cascade);

                entity.HasOne(e => e.PositionEntry)
                      .WithMany(p => p.Bets)
                      .HasForeignKey(b => b.PositionId)
                      .OnDelete(DeleteBehavior.SetNull);
            });

            modelBuilder.Entity<UserTeamPosition>(entity =>
            {
                entity.HasKey(e => e.PositionId);
                entity.ToTable("user_team_position");

                entity.Property(e => e.PositionId).HasColumnName("cd_position");
                entity.Property(e => e.UserId).HasColumnName("cd_user");
                entity.Property(e => e.TeamId).HasColumnName("cd_team");

                entity.Property(e => e.PrincipalAllocated)
                      .HasColumnType("decimal(18, 8)")
                      .HasColumnName("nr_principal_allocated");

                entity.Property(e => e.CurrentCapital)
                      .HasColumnType("decimal(18, 8)")
                      .HasColumnName("nr_current_capital");

                entity.Property(e => e.AutoCompound)
                      .HasColumnName("is_auto_compound")
                      .HasDefaultValue(true);

                entity.Property(e => e.Status)
                      .HasConversion<int>()
                      .HasColumnName("in_status")
                      .HasDefaultValue(TeamPositionStatus.Active);

                entity.Property(e => e.OnChainPositionAddress)
                      .HasMaxLength(64)
                      .HasColumnName("tx_onchain_position");

                entity.Property(e => e.OnChainVaultAddress)
                      .HasMaxLength(64)
                      .HasColumnName("tx_onchain_vault");

                entity.Property(e => e.LastOnChainSignature)
                      .HasMaxLength(128)
                      .HasColumnName("tx_last_onchain_signature");

                entity.Property(e => e.OnChainCluster)
                      .HasMaxLength(32)
                      .HasColumnName("tx_onchain_cluster");

                entity.Property(e => e.CurrentLamports)
                      .HasColumnName("nr_current_lamports");

                entity.Property(e => e.CreatedAt)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_created");

                entity.Property(e => e.UpdatedAt)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_updated");

                entity.Property(e => e.ClosedAt)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_closed")
                      .IsRequired(false);

                entity.HasIndex(e => new { e.UserId, e.TeamId })
                      .IsUnique();

                entity.HasOne(e => e.User)
                      .WithMany(u => u.TeamPositions)
                      .HasForeignKey(e => e.UserId)
                      .OnDelete(DeleteBehavior.Cascade);

                entity.HasOne(e => e.Team)
                      .WithMany(t => t.UserPositions)
                      .HasForeignKey(e => e.TeamId)
                      .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<MatchMetricSnapshot>(entity =>
            {
                entity.HasKey(e => e.MatchMetricSnapshotId);
                entity.ToTable("match_metric_snapshot");

                entity.Property(e => e.MatchMetricSnapshotId)
                      .HasColumnName("cd_match_metric_snapshot")
                      .ValueGeneratedOnAdd();

                entity.Property(e => e.MatchId).HasColumnName("cd_match");
                entity.Property(e => e.TeamId).HasColumnName("cd_team");

                entity.Property(e => e.CapturedAtUtc)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_captured_at");

                entity.Property(e => e.PercentageChange)
                      .HasColumnType("decimal(18, 8)")
                      .HasColumnName("nr_percentage_change");

                entity.Property(e => e.QuoteVolume)
                      .HasColumnType("decimal(28, 8)")
                      .HasColumnName("nr_quote_volume");

                entity.Property(e => e.TradeCount)
                      .HasColumnName("nr_trade_count");

                entity.HasIndex(e => new { e.MatchId, e.TeamId, e.CapturedAtUtc });

                entity.HasOne(e => e.Match)
                      .WithMany(m => m.MetricSnapshots)
                      .HasForeignKey(e => e.MatchId)
                      .OnDelete(DeleteBehavior.Cascade);

                entity.HasOne(e => e.Team)
                      .WithMany(t => t.MetricSnapshots)
                      .HasForeignKey(e => e.TeamId)
                      .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<MatchScoreEvent>(entity =>
            {
                entity.HasKey(e => e.MatchScoreEventId);
                entity.ToTable("match_score_event");

                entity.Property(e => e.MatchScoreEventId)
                      .HasColumnName("cd_match_score_event")
                      .ValueGeneratedOnAdd();

                entity.Property(e => e.MatchId).HasColumnName("cd_match");
                entity.Property(e => e.TeamId).HasColumnName("cd_team");

                entity.Property(e => e.RuleType)
                      .HasConversion<string>()
                      .HasColumnName("in_rule_type")
                      .HasMaxLength(40);

                entity.Property(e => e.EventType)
                      .HasColumnName("tx_event_type")
                      .HasMaxLength(80);

                entity.Property(e => e.ReasonCode)
                      .HasColumnName("tx_reason_code")
                      .HasMaxLength(80);

                entity.Property(e => e.Points).HasColumnName("nr_points");
                entity.Property(e => e.EventSequence).HasColumnName("nr_event_sequence");

                entity.Property(e => e.TeamPercentageChange)
                      .HasColumnType("decimal(18, 8)")
                      .HasColumnName("nr_team_percentage_change");

                entity.Property(e => e.OpponentPercentageChange)
                      .HasColumnType("decimal(18, 8)")
                      .HasColumnName("nr_opponent_percentage_change");

                entity.Property(e => e.TeamQuoteVolume)
                      .HasColumnType("decimal(28, 8)")
                      .HasColumnName("nr_team_quote_volume");

                entity.Property(e => e.OpponentQuoteVolume)
                      .HasColumnType("decimal(28, 8)")
                      .HasColumnName("nr_opponent_quote_volume");

                entity.Property(e => e.MetricDelta)
                      .HasColumnType("decimal(28, 8)")
                      .HasColumnName("nr_metric_delta");

                entity.Property(e => e.WindowStartUtc)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_window_start");

                entity.Property(e => e.WindowEndUtc)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_window_end");

                entity.Property(e => e.Description)
                      .HasColumnName("tx_description");

                entity.Property(e => e.EventTimeUtc)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_event_time");

                entity.HasIndex(e => new { e.MatchId, e.EventSequence }).IsUnique();

                entity.HasOne(e => e.Match)
                      .WithMany(m => m.ScoreEvents)
                      .HasForeignKey(e => e.MatchId)
                      .OnDelete(DeleteBehavior.Cascade);

                entity.HasOne(e => e.Team)
                      .WithMany(t => t.ScoreEvents)
                      .HasForeignKey(e => e.TeamId)
                      .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<MatchScoreState>(entity =>
            {
                entity.HasKey(e => e.MatchId);
                entity.ToTable("match_score_state");

                entity.Property(e => e.MatchId).HasColumnName("cd_match");

                entity.Property(e => e.ThresholdsAwardedToTeamA)
                      .HasColumnName("nr_thresholds_awarded_a")
                      .HasDefaultValue(0);

                entity.Property(e => e.ThresholdsAwardedToTeamB)
                      .HasColumnName("nr_thresholds_awarded_b")
                      .HasDefaultValue(0);

                entity.Property(e => e.LastPercentageLeaderTeamId)
                      .HasColumnName("cd_last_percentage_leader")
                      .IsRequired(false);

                entity.Property(e => e.LastVolumeLeaderTeamId)
                      .HasColumnName("cd_last_volume_leader")
                      .IsRequired(false);

                entity.Property(e => e.LastProcessedVolumeWindowStartUtc)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_last_volume_window_start");

                entity.Property(e => e.LastProcessedVolumeWindowEndUtc)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_last_volume_window_end");

                entity.Property(e => e.LastEventSequence)
                      .HasColumnName("nr_last_event_sequence")
                      .HasDefaultValue(0);

                entity.Property(e => e.LastSnapshotAtUtc)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_last_snapshot_at");

                entity.Property(e => e.CreatedAtUtc)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_created_at");

                entity.Property(e => e.UpdatedAtUtc)
                      .HasColumnType("timestamp with time zone")
                      .HasColumnName("dt_updated_at");
            });

            Seed(modelBuilder);
        }

        public void Seed(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<PostCategory>().HasData(
                new PostCategory { Id = 1, Name = "Technology" },
                new PostCategory { Id = 2, Name = "Science" },
                new PostCategory { Id = 3, Name = "Health" },
                new PostCategory { Id = 4, Name = "Education" },
                new PostCategory { Id = 5, Name = "Business" }
            );

            // var posts = PostSeedDatax.GetPosts();
            // foreach (var post in posts)
            // {
            //     modelBuilder.Entity<Post>().HasData(new
            //     {
            //         post.Id,
            //         post.Title,
            //         post.Content,
            //         post.PostDate,
            //         post.PostCategoryId
            //     });
            // }
        }
    }
}
