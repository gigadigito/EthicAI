using DAL;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http.Headers;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using static GitHubService;

namespace BLL
{
    public class PostService
    {
        private readonly EthicAIDbContext _context;

        public PostService(EthicAIDbContext context)
        {
            _context = context;
        }
   
        // Método para criar um novo post
        public async Task CreatePostAsync(string title, string content, string url, byte[] imageBytes, int categoryId)
        {
            if (string.IsNullOrWhiteSpace(title))
                throw new ArgumentException("Title cannot be empty.", nameof(title));

            if (string.IsNullOrWhiteSpace(content))
                throw new ArgumentException("Content cannot be empty.", nameof(content));

            if (categoryId <= 0)
                throw new ArgumentException("Invalid category ID.", nameof(categoryId));

            try
            {
                var post = new Post
                {
                    Title = title,
                    Content = content,
                    Url = url,
                    PostDate = DateTime.Now,
                    Image = imageBytes,
                    PostCategoryId = categoryId
                };

                _context.Post.Add(post);
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateException ex)
            {
                // Log de erro detalhado
                Console.Error.WriteLine($"Database update error: {ex.Message}");
                throw new Exception("An error occurred while saving the post. Please try again later." + ex.Message + ex.InnerException?.Message, ex);
            }
            catch (Exception ex)
            {
                // Log de erro genérico
                Console.Error.WriteLine($"Unexpected error: {ex.Message}");
                throw new Exception("An unexpected error occurred. Please try again later.", ex);
            }
        }
        public async Task<string> SaveImageToSeedFolderAsync(byte[] imageBytes, string fileName)
        {
            // Diretório base da aplicação
            var baseDirectory = Directory.GetCurrentDirectory();
            var seedFolder = Path.Combine(baseDirectory, "wwwroot", "seed");

            // Verifica se o diretório existe, se não, cria
            if (!Directory.Exists(seedFolder))
            {
                Directory.CreateDirectory(seedFolder);
            }

            // Caminho completo do arquivo
            var filePath = Path.Combine(seedFolder, fileName);

            // Salva a imagem no diretório
            await File.WriteAllBytesAsync(filePath, imageBytes);

            return filePath;
        }
        public async Task<byte[]> GenerateSeedClassAsync()
        {
            // Define o diretório de destino para salvar a classe de seed
            var baseDirectory = Directory.GetCurrentDirectory();
            var seedFolder = Path.Combine(baseDirectory, "wwwroot", "seed");

            // Cria o diretório se ele não existir
            if (!Directory.Exists(seedFolder))
            {
                Directory.CreateDirectory(seedFolder);
            }

            // Inicializa o StringBuilder para construir a classe de seed
            var sb = new StringBuilder();
            sb.AppendLine("using System;");
            sb.AppendLine("using System.Collections.Generic;");
            sb.AppendLine();
            sb.AppendLine("namespace YourNamespaceHere");
            sb.AppendLine("{");
            sb.AppendLine("    public static class PostSeedData");
            sb.AppendLine("    {");
            sb.AppendLine("        public static List<Post> GetPosts()");
            sb.AppendLine("        {");
            sb.AppendLine("            return new List<Post>");
            sb.AppendLine("            {");

            // Recupera os posts do banco de dados
            var posts = await _context.Post.Include(p => p.PostCategory).ToListAsync();
            foreach (var post in posts)
            {
                sb.AppendLine("                new Post");
                sb.AppendLine("                {");
                sb.AppendLine($"                    Id = {post.Id},");
                sb.AppendLine($"                    Title = \"{post.Title.Replace("\"", "\\\"")}\",");
                sb.AppendLine($"                    Content = \"{post.Content.Replace("\"", "\\\"")}\",");
                sb.AppendLine($"                    PostDate = DateTime.Parse(\"{post.PostDate:yyyy-MM-dd HH:mm:ss}\"),");

                // Gera o array de bytes da imagem como string
                if (post.Image != null)
                {
                    var imageBase64 = Convert.ToBase64String(post.Image);
                    sb.AppendLine($"                    Image = Convert.FromBase64String(\"{imageBase64}\"),");
                }
                else
                {
                    sb.AppendLine("                    Image = null,");
                }

                sb.AppendLine($"                    PostCategoryId = {post.PostCategoryId}");
                sb.AppendLine("                },");
            }

            // Finaliza a lista e a classe
            sb.AppendLine("            };");
            sb.AppendLine("        }");
            sb.AppendLine("    }");
            sb.AppendLine("}");

            // Define o caminho para salvar o arquivo de classe
            var classPath = Path.Combine(seedFolder, "PostSeedData.cs");
            await File.WriteAllTextAsync(classPath, sb.ToString());

            // Lê o conteúdo da classe gerada como byte array para download
            var classBytes = await File.ReadAllBytesAsync(classPath);
            return classBytes;
        }



        public async Task DeletePostAsync(int postId)
        {
            var post = await _context.Post.FindAsync(postId);
            if (post != null)
            {
                _context.Post.Remove(post);
                await _context.SaveChangesAsync();
            }
        }
        public async Task<List<Post>> GetPostsAsync()
        {
            return await _context.Post
                .Include(p => p.PostCategory) // Inclui a categoria relacionada
                .OrderByDescending(p => p.PostDate) // Ordena pela data de postagem (mais recentes primeiro)
                .ToListAsync();
        }
        // Método para listar todas as categorias
        public async Task<List<PostCategory>> GetCategoriesAsync()
        {

            return await _context.PostCategory.ToListAsync();
        }

        // Método para listar os posts por categoria
        public async Task<List<Post>> GetPostsByCategoryAsync(int categoryId)
        {


            return await _context.Post
                                 .Where(p => p.PostCategoryId == categoryId)
                                 .ToListAsync();
        }
    }

}
