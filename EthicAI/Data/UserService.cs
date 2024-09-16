using Microsoft.EntityFrameworkCore;
using System.Threading.Tasks;
using EthicAI.EntityModel;
using DAL;

namespace EthicAI.Data
{
    public class UserService
    {
        private readonly EthicAIDbContext _dbContext;

        // Injetando o EthicAIDbContext via construtor
        public UserService(EthicAIDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        // Método assíncrono para buscar usuário por carteira
        public async Task<User> GetUserByWallet(string wallet)
        {
            try
            {
                var usuario = await _dbContext.User
                    .Where(x => x.Wallet == wallet)
                    .FirstOrDefaultAsync();

                return usuario;
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
                // Verifica se o usuário já existe pela carteira
                if (await _dbContext.User.AnyAsync(x => x.Wallet == usuario.Wallet))
                {
                    return "Usuário já existe";
                }

                // Verifica se o nome do jogador já existe
                if (await _dbContext.User.AnyAsync(x => x.Name == usuario.Name))
                {
                    return "Nome do jogador deve ser único";
                }

                usuario.DtCreate = DateTime.Now;
                usuario.DtUpdate = DateTime.Now;

                // Se não houver erros, salva o novo usuário
                _dbContext.Add(usuario);

                await _dbContext.SaveChangesAsync();

                return "OK";
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
