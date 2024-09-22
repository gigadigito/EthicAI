using Microsoft.Extensions.Configuration;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

using Microsoft.Extensions.Configuration;


namespace BLL
{
    public class SecretManager
    {
        private readonly IConfiguration _configuration;

        public SecretManager(IConfiguration configuration)
        {
            _configuration = configuration;
        }

        public string GetSecret(string key)
        {
            string secretValue = string.Empty;

            // First, check the environment variables, regardless of the environment (Local or Production)
            secretValue = Environment.GetEnvironmentVariable(key);

            if (!string.IsNullOrEmpty(secretValue))
            {
                return secretValue; // Return the value from the environment variable, if found
            }

            // If no environment variable is found, check the appsettings.json file
            secretValue = _configuration[key];

            if (!string.IsNullOrEmpty(secretValue))
            {
                return secretValue; // Return the value from appsettings.json, if found
            }

            // If no secret is found in either location, throw an exception
            throw new Exception($"Secret not found for key: {key}");
        }
    }
}
