using DAL;
using EthicAI.Data;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using System;
using System.Threading.Tasks;
using Xunit;

namespace EthicAI.Test
{
    public class UserServiceTests
    {
        private readonly UserService _userService;
        private readonly DbContextOptions<EthicAIDbContext> _dbContextOptions;

        public UserServiceTests()
        {
            // Configura��o de DbContext in-memory para simular o banco de dados
            _dbContextOptions = new DbContextOptionsBuilder<EthicAIDbContext>()
                .UseInMemoryDatabase(databaseName: "EthicAIDb")
                .Options;

            // Inst�ncia do EthicAIDbContext
            var context = new EthicAIDbContext(_dbContextOptions);

            // Inst�ncia do UserService passando o contexto simulado
            _userService = new UserService(context);
        }

        // M�todo para preparar o contexto simulado (in-memory)
        private EthicAIDbContext CreateContext()
        {
            return new EthicAIDbContext(_dbContextOptions);
        }

        // Teste do m�todo GetUserByWallet para um caso bem-sucedido
        [Fact]
        public async Task GetUserByWallet_ShouldReturnUser_WhenWalletExists()
        {
            // Arrange
            var wallet = "12345ABC";
            var context = CreateContext();

            // Populando o banco in-memory com um usu�rio
            var existingUser = new User { Wallet = wallet, Name = "John Doe" };
            context.User.Add(existingUser);
            await context.SaveChangesAsync();

            // Act
            var result = await _userService.GetUserByWallet(wallet);

            // Assert
            Assert.NotNull(result);
            Assert.Equal(wallet, result.Wallet);
        }

        // Teste do m�todo GetUserByWallet para o caso em que a carteira n�o existe
        [Fact]
        public async Task GetUserByWallet_ShouldReturnNull_WhenWalletDoesNotExist()
        {
            // Arrange
            var wallet = "NON_EXISTING_WALLET";
            var context = CreateContext();

            // Act
            var result = await _userService.GetUserByWallet(wallet);

            // Assert
            Assert.Null(result);
        }

        // Teste do m�todo AddUser para um caso bem-sucedido
        [Fact]
        public async Task AddUser_ShouldReturnOk_WhenUserIsValid()
        {
            // Arrange
            var context = CreateContext();
            var newUser = new User { Wallet = "67890DEF", Name = "Jane Doe" };

            // Act
            var result = await _userService.AddUser(newUser);

            // Assert
            Assert.Equal("OK", result);
        }

        // Teste do m�todo AddUser para o caso em que a carteira j� existe
        [Fact]
        public async Task AddUser_ShouldReturnUserAlreadyExists_WhenWalletExists()
        {
            // Arrange
            var context = CreateContext();
            var existingUser = new User { Wallet = "12345ABC", Name = "John Doe" };
            context.User.Add(existingUser);
            await context.SaveChangesAsync();

            var newUser = new User { Wallet = "12345ABC", Name = "New User" };

            // Act
            var result = await _userService.AddUser(newUser);

            // Assert
            Assert.Equal("Usu�rio j� existe", result);
        }

        // Teste do m�todo AddUser para o caso em que o nome j� existe
        [Fact]
        public async Task AddUser_ShouldReturnNameMustBeUnique_WhenNameExists()
        {
            // Arrange
            var context = CreateContext();
            var existingUser = new User { Wallet = "11111ABC", Name = "Jane Doe" };
            context.User.Add(existingUser);
            await context.SaveChangesAsync();

            var newUser = new User { Wallet = "67890DEF", Name = "Jane Doe" };

            // Act
            var result = await _userService.AddUser(newUser);

            // Assert
            Assert.Equal("Nome do jogador deve ser �nico", result);
        }

        // Teste do m�todo AddUser para o caso de carteira inv�lida
        [Fact]
        public async Task AddUser_ShouldReturnInvalidWallet_WhenWalletIsEmpty()
        {
            // Arrange
            var newUser = new User { Wallet = "", Name = "Jane Doe" };

            // Act
            var result = await _userService.AddUser(newUser);

            // Assert
            Assert.Equal("Carteira Inv�lida", result);
        }
    }
}
