using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace EthicAI.EntityModel
{
    public class ApplicationDbContext : DbContext
    {
        private readonly IConfiguration _configuration;

        public ApplicationDbContext(IConfiguration configuration)
        {
            _configuration = configuration;
        }

        public DbSet<User> User { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<User>(entity =>
            {
                entity.HasKey(e => e.UserID);
               
                entity.ToTable("user");

                entity.Property(e => e.UserID).HasColumnName("cd_user");

                entity.Property(e => e.Email)
                   .HasMaxLength(50)
                   .HasColumnName("tx_email");

                entity.Property(e => e.Wallet)
                    .IsRequired()
                    .HasMaxLength(50)
                    .HasColumnName("tx_wallet");

                entity.Property(e => e.Name)
                    .HasMaxLength(50)
                    .HasColumnName("nm_name");

                entity.Property(e => e.DtUpdate).HasColumnType("datetime")

                .HasColumnName("dt_update");
            });

            Seed(modelBuilder);
        }

        protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
        {
            if (!optionsBuilder.IsConfigured)
            {
                optionsBuilder.UseSqlServer(_configuration.GetConnectionString("DefaultConnection"), options =>
                {
                    options.EnableRetryOnFailure();
                   // options.TrustServerCertificate(true); // Ignora a verificação do certificado
                });
            }
        }

        public void Seed(ModelBuilder modelBuilder)
        {
            // Seeding lógica (se necessário)
        }
    }
}
