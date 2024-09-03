using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using NFT_JOGO.EntityModel;
using System.Threading.Tasks;

namespace NFT_JOGO.Data
{
    public class UsuarioService
    {
        private readonly IConfiguration _configuration;

        public UsuarioService(IConfiguration configuration) { 
            _configuration = configuration;
        }

        public Task<Usuario> GetUsuarioByWallet(string guid)
        {
            var Usuario = new Usuario();    
           
            using (ApplicationDbContext db = new ApplicationDbContext(_configuration))
            {
                Usuario =  db.Usuario.Where(x=>x.CarteiraEndereco == guid).FirstOrDefault();

                return Task.FromResult(Usuario);
            }
            return null;  
        }

        public Task<string> AddUsuario(Usuario Usuario)
        {
            String Result = "";
          
            using (ApplicationDbContext db = new ApplicationDbContext(_configuration))
            {
                if (String.IsNullOrEmpty(Usuario.CarteiraEndereco))
                {
                    Result = "Carteira Inválida";
                };


                if (db.Usuario.Where(x => x.CarteiraEndereco == Usuario.CarteiraEndereco).Any())
                {
                    Result = "Usuário já existe";
                };
               
                if (db.Usuario.Where(x => x.NomeJogador == Usuario.CarteiraEndereco).Any())
                {
                    Result = "Nome do jogador deve ser unica";
                };

                if (String.IsNullOrEmpty(Result))
                {
                    
                    db.Add(Usuario);

                    db.SaveChanges();

                    Result = "OK";
                }
 
            }

            return Task.FromResult(Result);

        }


    }
}
