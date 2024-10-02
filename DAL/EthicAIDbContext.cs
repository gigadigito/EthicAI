using DAL;
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


            Seed(modelBuilder);        }

        public void Seed(ModelBuilder modelBuilder)
        {
            // Lógica de seeding (se necessário)
        }
    }
}
