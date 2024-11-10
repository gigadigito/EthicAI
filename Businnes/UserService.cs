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

        // Método assíncrono para atualizar um usuário existente
        public async Task<string> UpdateUser(User usuario)
        {
            if (usuario == null || string.IsNullOrEmpty(usuario.Wallet))
            {
                return "Usuário inválido";
            }

            try
            {
                var existingUser = await _dbContext.User
                    .Where(x => x.Wallet == usuario.Wallet)
                    .FirstOrDefaultAsync();

                if (existingUser == null)
                {
                    return "Usuário não encontrado";
                }

                // Atualiza as propriedades necessárias
                existingUser.Name = usuario.Name;
                existingUser.Email = usuario.Email;
                existingUser.IsHuman = usuario.IsHuman;
                existingUser.IAName = usuario.IAName;
                existingUser.HumanRepresentative = usuario.HumanRepresentative;
                existingUser.Company = usuario.Company;
                existingUser.IAModel = usuario.IAModel;
                existingUser.DtUpdate = DateTime.Now;

                _dbContext.User.Update(existingUser);
                await _dbContext.SaveChangesAsync();

                return "1";
            }
            catch (DbUpdateException dbEx)
            {
                // Tratamento de erro relacionado ao banco de dados
                Console.WriteLine($"Erro de banco de dados: {dbEx.Message}");
                return "Erro ao atualizar o usuário no banco de dados.";
            }
            catch (Exception ex)
            {
                // Tratamento de outros erros não relacionados ao banco de dados
                Console.WriteLine($"Erro geral: {ex.Message}");
                return "Erro desconhecido ao atualizar o usuário.";
            }
        }
    }
}
