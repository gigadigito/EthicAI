using DAL;
using DAL.NftFutebol;
using DAL.Seed;
using Microsoft.EntityFrameworkCore;


namespace EthicAI.EntityModel
{
    public class EthicAIDbContext : DbContext
    {
        // Construtor que usa DbContextOptions, utilizado pelo Entity Framework
        public EthicAIDbContext(DbContextOptions<EthicAIDbContext> options)
            : base(options)
        {
        }

       public DbSet<User> User { get; set; }
       public DbSet<PreSalePurchase> PreSalePurchase { get; set; } // Adiciona o DbSet para PreSalePurchase
       public DbSet<Post> Post { get; set; }
       public DbSet<PostCategory> PostCategory { get; set; }
        public DbSet<Match> Match { get; set; }
        public DbSet<Team> Team { get; set; }
        public DbSet<Currency> Currency { get; set; }
        public DbSet<Bet> Bet { get; set; }


        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<User>(entity =>
            {
                entity.HasKey(e => e.UserID);
                entity.ToTable("user");
                entity.Property(e => e.UserID).HasColumnName("cd_user");
                entity.Property(e => e.Name).HasMaxLength(50).HasColumnName("nm_name");
                entity.Property(e => e.Email).HasMaxLength(254).HasColumnName("tx_email");
                entity.Property(e => e.Wallet).IsRequired().HasMaxLength(50).HasColumnName("tx_wallet");
                entity.Property(e => e.DtUpdate).HasColumnType("datetime").HasColumnName("dt_update");
                entity.Property(e => e.IsHuman).HasColumnName("is_human");
                entity.Property(e => e.HumanCaptcha).HasMaxLength(100).HasColumnName("tx_human_captcha");
                entity.Property(e => e.DtHumanValidation).HasColumnType("datetime").HasColumnName("dt_human_validation");
                entity.Property(e => e.LastLogin).HasColumnType("datetime").HasColumnName("dt_last_login");
                entity.Property(e => e.IAName).HasMaxLength(100).HasColumnName("nm_ia");
                entity.Property(e => e.HumanRepresentative).HasMaxLength(100).HasColumnName("nm_human_representative");
                entity.Property(e => e.Company).HasMaxLength(100).HasColumnName("nm_company");
                entity.Property(e => e.IAModel).HasMaxLength(100).HasColumnName("nm_ia_model");
                entity.Property(e => e.DtCreate).HasColumnName("dt_create");

                // Novo campo Balance
                entity.Property(e => e.Balance)
                      .HasColumnType("decimal(18, 2)")
                      .HasColumnName("nr_balance")
                      .HasDefaultValue(0); // se desejar um valor padrão
            });

            // EntityModel/EthicAIDbContext.cs
            modelBuilder.Entity<PreSalePurchase>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.ToTable("pre_sale_purchase");
                entity.Property(e => e.Id).HasColumnName("id_purchase");
                entity.Property(e => e.UserId).IsRequired().HasColumnName("user_id");
                entity.Property(e => e.SolAmount).HasColumnType("decimal(18, 8)").HasColumnName("sol_amount");
                entity.Property(e => e.EthicAIAmt).HasColumnType("decimal(18, 8)").HasColumnName("ethic_ai_amount");
                entity.Property(e => e.PurchaseDate).HasColumnType("datetime").HasColumnName("purchase_date");
                entity.Property(e => e.TransactionHash).HasMaxLength(100).HasColumnName("transaction_hash");

                // Configuração de relacionamento
                entity.HasOne(e => e.User) // Certifique-se de que o User está mapeado corretamente
                      .WithMany(u => u.PreSalePurchases)
                      .HasForeignKey(e => e.UserId)
                      .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<Post>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.ToTable("post");
                entity.Property(e => e.Title).IsRequired().HasMaxLength(100).HasColumnName("tx_title");
                entity.Property(e => e.Content).IsRequired().HasColumnName("tx_content");
                entity.Property(e => e.Url).IsRequired().HasMaxLength(100).HasColumnName("tx_url");
                entity.Property(e => e.PostDate).HasColumnType("datetime").HasColumnName("dt_post");
                entity.Property(e => e.Image)
               .HasColumnType("varbinary(max)")
               .HasColumnName("aq_image");
                entity.Property(e => e.PostCategoryId).HasColumnName("post_category_id");

                entity.HasOne(e => e.PostCategory)
                      .WithMany(c => c.Posts)
                      .HasForeignKey(e => e.PostCategoryId)
                      .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<PostCategory>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedNever(); // Desativa o auto-incremento
                entity.ToTable("post_category");
                entity.Property(e => e.Name).IsRequired().HasMaxLength(50).HasColumnName("tx_name");
            });

            modelBuilder.Entity<Match>(entity =>
            {
                entity.HasKey(e => e.MatchId);
                entity.ToTable("match");

                entity.Property(e => e.MatchId).HasColumnName("cd_match");
                entity.Property(e => e.StartTime).HasColumnType("datetime").HasColumnName("dt_start_time");
                entity.Property(e => e.EndTime).HasColumnType("datetime").HasColumnName("dt_end_time");

                entity.Property(e => e.TeamAId).HasColumnName("cd_team_a");
                entity.Property(e => e.TeamBId).HasColumnName("cd_team_b");

                entity.Property(e => e.ScoreA).HasColumnName("nr_score_a");
                entity.Property(e => e.ScoreB).HasColumnName("nr_score_b");

                entity.Property(e => e.Status)
                      .HasConversion<string>()
                      .HasColumnName("in_status");

                entity.HasOne(e => e.TeamA)
                      .WithMany(t => t.MatchesAsTeamA)
                      .HasForeignKey(e => e.TeamAId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasOne(e => e.TeamB)
                      .WithMany(t => t.MatchesAsTeamB)
                      .HasForeignKey(e => e.TeamBId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasMany(e => e.Bets)
                      .WithOne(b => b.Match)
                      .HasForeignKey(b => b.MatchId)
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
            });

            modelBuilder.Entity<Currency>(entity =>
            {
                entity.HasKey(e => e.CurrencyId);
                entity.ToTable("currency");

                entity.Property(e => e.CurrencyId).HasColumnName("cd_currency");
                entity.Property(e => e.Name).IsRequired().HasMaxLength(50).HasColumnName("tx_name");
                entity.Property(e => e.Symbol).IsRequired().HasMaxLength(50).HasColumnName("tx_symbol");
                entity.Property(e => e.PercentageChange).HasColumnType("decimal(5, 2)").HasColumnName("nr_percentage_change");
                entity.Property(e => e.LastUpdated).HasColumnType("datetime").HasColumnName("dt_last_updated");
            });


            modelBuilder.Entity<Bet>(entity =>
            {
                entity.HasKey(e => e.BetId);
                entity.ToTable("bet");

                entity.Property(e => e.BetId).HasColumnName("cd_bet");
                entity.Property(e => e.MatchId).HasColumnName("cd_match");
                entity.Property(e => e.TeamId).HasColumnName("cd_team");
                entity.Property(e => e.UserId).HasColumnName("cd_user");
                entity.Property(e => e.Amount).HasColumnType("decimal(18, 2)").HasColumnName("nr_amount");
                entity.Property(e => e.BetTime).HasColumnType("datetime").HasColumnName("dt_bet_time");

                entity.Property(e => e.Position).HasColumnName("nr_position"); // Nova coluna
                // Novos campos: Claimed e ClaimedAt
                entity.Property(e => e.Claimed)
                      .HasColumnName("is_claimed")
                      .HasDefaultValue(false);

                entity.Property(e => e.ClaimedAt)
                 .HasColumnName("dt_claimed_at")
                 .HasColumnType("datetime2")
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
            });


            Seed(modelBuilder);        }

        public void Seed(ModelBuilder modelBuilder)
        {


            modelBuilder.Entity<PostCategory>().HasData(
                      new PostCategory { Id = 1, Name = "Technology" },
                      new PostCategory { Id = 2, Name = "Science" },
                      new PostCategory { Id = 3, Name = "Health" },
                      new PostCategory { Id = 4, Name = "Education" },
                      new PostCategory { Id = 5, Name = "Business" }
            );

           // SeedTriggers();

            // Adiciona posts gerados do PostSeedData
            //var posts = PostSeedDatax.GetPosts();
            //foreach (var post in posts)
            //{
            //    modelBuilder.Entity<Post>().HasData(new
            //    {
            //        post.Id,
            //        post.Title,
            //        post.Content,
            //        post.PostDate,
            //        post.PostCategoryId
            //    });

            //}

        }
        //private void SeedTriggers()
        //{
        //    using (var connection = Database.GetDbConnection())
        //    {
        //        connection.Open(); // Certifique-se de que a conexão está aberta
        //        using (var command = connection.CreateCommand())
        //        {
        //            command.CommandText = @"
        //        CREATE OR ALTER TRIGGER trg_UpdateBetPosition
        //        ON [dbo].[bet]
        //        AFTER INSERT
        //        AS
        //        BEGIN
        //            WITH RankedBets AS (
        //                SELECT
        //                    cd_bet,
        //                    ROW_NUMBER() OVER (
        //                        PARTITION BY cd_match, cd_team
        //                        ORDER BY dt_bet_time
        //                    ) AS Position
        //                FROM [dbo].[bet]
        //            )
        //            UPDATE b
        //            SET nr_position = rb.Position
        //            FROM [dbo].[bet] b
        //            INNER JOIN RankedBets rb
        //            ON b.cd_bet = rb.cd_bet
        //            WHERE b.nr_position IS NULL;
        //        END";
        //            command.ExecuteNonQuery();
        //        }
        //    }
        //}

    }
}
