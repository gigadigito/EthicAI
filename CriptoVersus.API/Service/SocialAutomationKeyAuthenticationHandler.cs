using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

/// <summary>
/// Autentica automacoes sociais pelo header <c>X-Social-Key</c> (n8n) sem JWT.
/// Chave invalida, vazia, ausente ou sem <c>SocialAutomation:ApiKey</c> configurada
/// nao autentica. Nenhum valor de chave e logado ou devolvido ao cliente.
/// </summary>
public sealed class SocialAutomationKeyAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    private readonly ISocialAutomationAuthenticationService _authentication;

    public SocialAutomationKeyAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        ISocialAutomationAuthenticationService authentication)
        : base(options, logger, encoder)
    {
        _authentication = authentication;
    }

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!_authentication.HasValidKey(Request))
            return Task.FromResult(AuthenticateResult.NoResult());

        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.Name, SocialAutomationDefaults.PrincipalName)],
            Scheme.Name);
        var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }

    protected override async Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;

        if (!Response.HasStarted)
            await Response.WriteAsJsonAsync(new { message = SocialAutomationDefaults.ChallengeMessage });
    }
}

public static class SocialAutomationAuthenticationExtensions
{
    /// <summary>
    /// Registra o scheme <see cref="SocialAutomationDefaults.AuthenticationScheme"/>.
    /// O scheme so e consultado por politicas que o declarem explicitamente; o JWT
    /// continua sendo o scheme padrao da API.
    /// </summary>
    public static AuthenticationBuilder AddSocialAutomationKeyAuthentication(this AuthenticationBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        return builder.AddScheme<AuthenticationSchemeOptions, SocialAutomationKeyAuthenticationHandler>(
            SocialAutomationDefaults.AuthenticationScheme,
            _ => { });
    }

    /// <summary>
    /// Politica <see cref="SocialAutomationDefaults.PolicyName"/>: acesso por JWT Bearer
    /// autenticado OU por <c>X-Social-Key</c> valida. Aplicada antes da execucao do
    /// controller; sem <c>[AllowAnonymous]</c> em operacoes de escrita.
    /// </summary>
    public static void AddSocialAutomationAccessPolicy(this AuthorizationOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        options.AddPolicy(SocialAutomationDefaults.PolicyName, policy => policy
            .AddAuthenticationSchemes(
                JwtBearerDefaults.AuthenticationScheme,
                SocialAutomationDefaults.AuthenticationScheme)
            .RequireAuthenticatedUser());
    }
}
