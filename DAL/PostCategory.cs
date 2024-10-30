using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DAL
{
    public class PostCategory
    {
        [Key]
        public int Id { get; set; }
        public string Name { get; set; } // Nome da categoria
        public ICollection<Post> Posts { get; set; } // Relacionamento com os posts
    }

}
