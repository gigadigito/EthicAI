using DAL;
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

    }
}
