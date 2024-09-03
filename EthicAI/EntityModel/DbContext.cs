using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace NFT_JOGO.EntityModel
{
    public class ApplicationDbContext : DbContext
    {
        private readonly IConfiguration _configuration;

        public ApplicationDbContext(IConfiguration configuration)
        {
            _configuration = configuration;
        }

        public DbSet<Usuario> Usuario { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<Usuario>(entity =>
            {
                entity.HasKey(e => e.UsuarioID);
                entity.ToTable("usuario");

                entity.Property(e => e.UsuarioID).HasColumnName("cd_usuario");

                entity.Property(e => e.CarteiraEndereco)
                    .IsRequired()
                    .HasMaxLength(50)
                    .HasColumnName("tx_carterira_endereco");

                entity.Property(e => e.NomeJogador)
                    .HasMaxLength(50)
                    .HasColumnName("nm_jogador");

                entity.Property(e => e.DataAtualizacao).HasColumnType("datetime")
                .HasColumnName("dt_atualizacao");
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
