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

            Seed(modelBuilder);
        }

        public void Seed(ModelBuilder modelBuilder)
        {
            // Lógica de seeding (se necessário)
        }
    }
}
