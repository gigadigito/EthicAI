using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using DAL;

namespace EthicAI.EntityModel
{
    public class EthicAIDbContext : DbContext
    {
        private readonly IConfiguration _configuration;

        // Construtor para produção que utiliza IConfiguration
        public EthicAIDbContext(IConfiguration configuration)
        {
            _configuration = configuration;
        }

        // Construtor adicional para testes e migrações, que utiliza DbContextOptions
        public EthicAIDbContext(DbContextOptions<EthicAIDbContext> options)
            : base(options)
        {
        }

        public DbSet<User> User { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<User>(entity =>
            {
                // Set the primary key for the User entity
                entity.HasKey(e => e.UserID);

                // Define the table name for the User entity
                entity.ToTable("user");

                // Define the UserID property and map it to the "cd_user" column
                entity.Property(e => e.UserID).HasColumnName("cd_user");

                // Define the Name property with a max length of 50 and map it to "nm_name"
                entity.Property(e => e.Name)
                    .HasMaxLength(50)
                    .HasColumnName("nm_name");

                // Define the Email property with a max length of 254 and map it to "tx_email"
                entity.Property(e => e.Email)
                    .HasMaxLength(254)
                    .HasColumnName("tx_email");

                // Define the Wallet property, make it required, and map it to "tx_wallet"
                entity.Property(e => e.Wallet)
                    .IsRequired()
                    .HasMaxLength(50)
                    .HasColumnName("tx_wallet");

                // Define the DtUpdate property, set it as a datetime type, and map it to "dt_update"
                entity.Property(e => e.DtUpdate)
                    .HasColumnType("datetime")
                    .HasColumnName("dt_update");

                // Define the IsHuman property to differentiate between a human or machine user
                entity.Property(e => e.IsHuman)
                    .HasColumnName("is_human");

                // Define the HumanCaptcha property for storing CAPTCHA results (only for human users)
                entity.Property(e => e.HumanCaptcha)
                    .HasMaxLength(100)
                    .HasColumnName("tx_human_captcha");

                // Define the DtHumanValidation property to store the validation timestamp for humans
                entity.Property(e => e.DtHumanValidation)
                    .HasColumnType("datetime")
                    .HasColumnName("dt_human_validation");

                entity.Property(e => e.LastLogin)
                    .HasColumnType("datetime")
                     .HasColumnName("dt_last_login");

                // Define the IAName property for storing the name of the AI (only for machine users)
                entity.Property(e => e.IAName)
                    .HasMaxLength(100)
                    .HasColumnName("nm_ia");

                // Define the HumanRepresentative property for storing the name of the human representative (for machine users)
                entity.Property(e => e.HumanRepresentative)
                    .HasMaxLength(100)
                    .HasColumnName("nm_human_representative");

                // Define the Company property as optional for storing the company name (for machine users)
                entity.Property(e => e.Company)
                    .HasMaxLength(100)
                    .HasColumnName("nm_company");

                // Define the IAModel property as optional for storing the AI model name (for machine users)
                entity.Property(e => e.IAModel)
                    .HasMaxLength(100)
                    .HasColumnName("nm_ia_model");

                entity.Property(e => e.DtCreate)
                    .HasColumnName("dt_create");
            });

            Seed(modelBuilder);
        }

        // O método OnConfiguring será usado apenas se DbContextOptions não estiver configurado
        protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
        {
            if (!optionsBuilder.IsConfigured && _configuration != null)
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
