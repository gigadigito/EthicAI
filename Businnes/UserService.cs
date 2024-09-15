
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using DAL;
using System.Threading.Tasks;
using EthicAI.EntityModel;

namespace BLL
{
    public class UserService
    {
        private readonly IConfiguration _configuration;

        public UserService(IConfiguration configuration)
        {
            _configuration = configuration;
        }

        // Método assíncrono para buscar usuário por carteira
        public async Task<User> GetUserByWallet(string wallet)
        {
            try
            {
                using (var db = new EthicAIDbContext(_configuration))
                {
                    var usuario = await db.User
                        .Where(x => x.Wallet == wallet)
                        .FirstOrDefaultAsync();

                    return usuario;
                }
            }
            catch (DbUpdateException dbEx)
            {
                // Log do erro e tratamento de erro específico do banco de dados
                Console.WriteLine($"Erro de banco de dados: {dbEx.Message}");
                throw new Exception("Ocorreu um erro ao acessar o banco de dados ao buscar o usuário.");
            }
            catch (Exception ex)
            {
                // Captura de outros erros gerais
                Console.WriteLine($"Erro geral: {ex.Message}");
                throw new Exception("Ocorreu um erro ao buscar o usuário.");
            }
        }

        // Método assíncrono para adicionar um usuário
        public async Task<string> AddUser(User usuario)
        {
            if (string.IsNullOrEmpty(usuario.Wallet))
            {
                return "Carteira Inválida";
            }

            try
            {
                using (var db = new EthicAIDbContext(_configuration))
                {
                    // Verifica se o usuário já existe pela carteira
                    if (await db.User.AnyAsync(x => x.Wallet == usuario.Wallet))
                    {
                        return "Usuário já existe";
                    }

                    // Verifica se o nome do jogador já existe
                    if (await db.User.AnyAsync(x => x.Name == usuario.Name))
                    {
                        return "Nome do jogador deve ser único";
                    }

                    usuario.DtCreate = DateTime.Now;
                    usuario.DtUpdate = DateTime.Now;

                    // Se não houver erros, salva o novo usuário
                    db.Add(usuario);

                    await db.SaveChangesAsync();

                    return "OK";
                }
            }
            catch (DbUpdateException dbEx)
            {
                // Tratamento de erro relacionado ao banco de dados
                Console.WriteLine($"Erro de banco de dados: {dbEx.Message}");
                return "Erro ao adicionar o usuário ao banco de dados.";
            }
            catch (Exception ex)
            {
                // Tratamento de outros erros não relacionados ao banco de dados
                Console.WriteLine($"Erro geral: {ex.Message}");
                return "Erro desconhecido ao adicionar o usuário.";
            }
        }
    }
}
