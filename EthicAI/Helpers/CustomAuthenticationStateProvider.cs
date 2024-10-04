
    using Microsoft.AspNetCore.Components.Authorization;
    using System.Security.Claims;
    using System.Threading.Tasks;
    using Blazored.SessionStorage;
    using DAL;

    public class CustomAuthenticationStateProvider : AuthenticationStateProvider
    {
        private readonly ISessionStorageService _sessionStorage;

        public CustomAuthenticationStateProvider(ISessionStorageService sessionStorage)
        {
            _sessionStorage = sessionStorage;
        }

        public override async Task<AuthenticationState> GetAuthenticationStateAsync()
        {
            var user = await _sessionStorage.GetItemAsync<User>("User");

            ClaimsIdentity identity;
            if (user != null)
            {
                // Create ClaimsIdentity with User info
                identity = new ClaimsIdentity(new[]
                {
                new Claim(ClaimTypes.Name, user.Name),
                new Claim(ClaimTypes.NameIdentifier, user.UserID.ToString()),
                new Claim("Wallet", user.Wallet),
                new Claim("IsHuman", user.IsHuman.ToString())
            }, "customAuth");
            }
            else
            {
                identity = new ClaimsIdentity(); // No identity if user is not found
            }

            var userClaimsPrincipal = new ClaimsPrincipal(identity);
            return new AuthenticationState(userClaimsPrincipal);
        }

        public void MarkUserAsAuthenticated(User user)
        {
            var identity = new ClaimsIdentity(new[]
            {
            new Claim(ClaimTypes.Name, user.Name),
            new Claim(ClaimTypes.NameIdentifier, user.UserID.ToString()),
            new Claim("Wallet", user.Wallet),
            new Claim("IsHuman", user.IsHuman.ToString())
        }, "customAuth");

            var userClaimsPrincipal = new ClaimsPrincipal(identity);
            NotifyAuthenticationStateChanged(Task.FromResult(new AuthenticationState(userClaimsPrincipal)));
        }

        public void MarkUserAsLoggedOut()
        {
            var identity = new ClaimsIdentity();
            var userClaimsPrincipal = new ClaimsPrincipal(identity);
            NotifyAuthenticationStateChanged(Task.FromResult(new AuthenticationState(userClaimsPrincipal)));
        }
    }


