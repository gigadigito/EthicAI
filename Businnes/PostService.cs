using DAL;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

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
        public async Task CreatePostAsync(string title, string content, byte[] imageBytes, int categoryId)
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
