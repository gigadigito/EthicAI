using Microsoft.EntityFrameworkCore;
using System.Threading.Tasks;
using EthicAI.EntityModel;
using DAL;

namespace EthicAI.Data
{
    public class UserService
    {
        private readonly EthicAIDbContext _dbContext;

        // Injecting the EthicAIDbContext via constructor
        public UserService(EthicAIDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        // Asynchronous method to fetch a user by wallet
        public async Task<User> GetUserByWallet(string wallet)
        {
            try
            {
                var user = await _dbContext.User
                    .Where(x => x.Wallet == wallet)
                    .FirstOrDefaultAsync();

                return user;
            }
            catch (DbUpdateException dbEx)
            {
                // Log the error and handle specific database-related error
                Console.WriteLine($"Database error: {dbEx.Message}");
                throw new Exception("An error occurred while accessing the database to fetch the user.");
            }
            catch (Exception ex)
            {
                // Capture other general errors
                Console.WriteLine($"General error: {ex.Message}");
                throw new Exception("An error occurred while fetching the user.");
            }
        }

        // Asynchronous method to add a new user
        public async Task<string> AddUser(User user)
        {
            if (string.IsNullOrEmpty(user.Wallet))
            {
                return "Invalid wallet";
            }

            try
            {
                // Check if the user already exists by wallet
                if (await _dbContext.User.AnyAsync(x => x.Wallet == user.Wallet))
                {
                    return "User already exists";
                }

                user.DtCreate = DateTime.Now;
                user.DtUpdate = DateTime.Now;

                // If no errors, save the new user
                _dbContext.Add(user);

                await _dbContext.SaveChangesAsync();

                return "OK";
            }
            catch (DbUpdateException dbEx)
            {
                // Handle database-related error
                Console.WriteLine($"Database error: {dbEx.Message}");
                return "Error adding the user to the database.";
            }
            catch (Exception ex)
            {
                // Handle other non-database-related errors
                Console.WriteLine($"General error: {ex.Message}");
                return "Unknown error while adding the user.";
            }
        }

        // Asynchronous method to update an existing user
        public async Task<string> UpdateUser(User user)
        {
            if (user == null || string.IsNullOrEmpty(user.Wallet))
            {
                return "Invalid user";
            }

            try
            {
                var existingUser = await _dbContext.User
                    .Where(x => x.Wallet == user.Wallet)
                    .FirstOrDefaultAsync();

                if (existingUser == null)
                {
                    return "User not found";
                }

                // Update necessary properties
                existingUser.Name = user.Name;
                existingUser.Email = user.Email;
                existingUser.IsHuman = user.IsHuman;
                existingUser.IAName = user.IAName;
                existingUser.HumanRepresentative = user.HumanRepresentative;
                existingUser.Company = user.Company;
                existingUser.IAModel = user.IAModel;
                existingUser.DtUpdate = DateTime.Now;
                existingUser.DtHumanValidation = user.DtHumanValidation;
                
                _dbContext.User.Update(existingUser);
                await _dbContext.SaveChangesAsync();

                return "User successfully updated";
            }
            catch (DbUpdateException dbEx)
            {
                // Handle database-related error
                Console.WriteLine($"Database error: {dbEx.Message}");
                return "Error updating the user in the database.";
            }
            catch (Exception ex)
            {
                // Handle other non-database-related errors
                Console.WriteLine($"General error: {ex.Message}");
                return "Unknown error while updating the user.";
            }
        }
    }
}
