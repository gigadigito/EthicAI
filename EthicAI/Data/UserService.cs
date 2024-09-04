using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using EthicAI.EntityModel;
using System.Threading.Tasks;

namespace EthicAI.Data
{
    public class UserService
    {
        private readonly IConfiguration _configuration;

        public UserService(IConfiguration configuration) { 
            _configuration = configuration;
        }

        public Task<User> GetUserByWallet(string guid)
        {
            var Usuario = new User();    
           
            using (ApplicationDbContext db = new ApplicationDbContext(_configuration))
            {
                Usuario =  db.User.Where(x=>x.Wallet == guid).FirstOrDefault();

                return Task.FromResult(Usuario);
            }
            return null;  
        }

        public Task<string> AddUser(User Usuario)
        {
            String Result = "";
          
            using (ApplicationDbContext db = new ApplicationDbContext(_configuration))
            {
                if (String.IsNullOrEmpty(Usuario.Wallet))
                {
                    Result = "Carteira Inválida";
                };


                if (db.User.Where(x => x.Wallet == Usuario.Wallet).Any())
                {
                    Result = "Usuário já existe";
                };
               
                if (db.User.Where(x => x.Name == Usuario.Wallet).Any())
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
