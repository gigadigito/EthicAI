using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Security.Claims;
using System.Text;
using CriptoVersus.API.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace CriptoVersus.API.Tests;

/// <summary>
/// Pipeline minimo de autenticacao, autorizacao e (opcionalmente) rate limiting usado pelos
/// testes de contrato de acesso da API. Replica a configuracao real de Program.cs: JWT Bearer
/// como scheme padrao, fallback policy exigindo usuario autenticado, politica SocialAutomation
/// e a politica de rate limit dos endpoints de transmissao.
/// </summary>
internal static class ApiAuthorizationTestHarness
{
    public const string ConfiguredKey = "social-test-key-do-not-use";
    public const string JwtSigningKey = "unit-test-jwt-signing-key-0123456789abcdef";

    public static Endpoint EndpointFor(Type controller, string method)
    {
        var methodInfo = controller.GetMethod(method)
            ?? throw new InvalidOperationException($"{controller.Name}.{method} nao encontrado.");

        var metadata = new List<object>();
        metadata.AddRange(controller.GetCustomAttributes(true));
        metadata.AddRange(methodInfo.GetCustomAttributes(true));

        return new Endpoint(
            _ => Task.CompletedTask,
            new EndpointMetadataCollection(metadata),
            $"{controller.Name}.{method}");
    }

    public static string CreateJwt(string signingKey, TimeSpan? lifetime = null)
    {
        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
            SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            claims: [new Claim(ClaimTypes.Name, "tester")],
            notBefore: DateTime.UtcNow.AddMinutes(-1),
            expires: DateTime.UtcNow.Add(lifetime ?? TimeSpan.FromMinutes(5)),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>
    /// Executa uma requisicao contra o pipeline. <paramref name="endpoint"/> nulo simula uma
    /// rota sem endpoint casado (nao publicada); o resultado entao depende da fallback policy.
    /// </summary>
    public static async Task<int> ExecuteRequestAsync(
        Endpoint? endpoint,
        string? configuredKey = ConfiguredKey,
        string? socialKey = null,
        string? bearerToken = null,
        Action<RateLimiterOptions>? configureRateLimiter = null,
        string? remoteIp = null)
    {
        await using var provider = BuildPipelineProvider(configuredKey, configureRateLimiter);
        var context = CreateRequestContext(provider, endpoint, socialKey, bearerToken, remoteIp);
        await BuildPipeline(provider, configureRateLimiter is not null)(context);
        return context.Response.StatusCode;
    }

    public static DefaultHttpContext CreateRequestContext(ServiceProvider provider, Endpoint? endpoint,
        string? socialKey = null, string? bearerToken = null, string? remoteIp = null)
    {
        var context = new DefaultHttpContext { RequestServices = provider };
        if (socialKey is not null)
            context.Request.Headers[SocialAutomationDefaults.HeaderName] = socialKey;
        if (bearerToken is not null)
            context.Request.Headers.Authorization = $"Bearer {bearerToken}";
        if (remoteIp is not null)
            context.Connection.RemoteIp = IPAddress.Parse(remoteIp);
        context.SetEndpoint(endpoint);
        return context;
    }

    public static RequestDelegate BuildPipeline(ServiceProvider provider, bool withRateLimiter)
    {
        var app = new ApplicationBuilder(provider);
        if (withRateLimiter) app.UseRateLimiter();
        app.UseAuthentication();
        app.UseAuthorization();
        app.Run(httpContext =>
        {
            httpContext.Response.StatusCode = StatusCodes.Status200OK;
            return Task.CompletedTask;
        });
        return app.Build();
    }

    public static ServiceProvider BuildPipelineProvider(string? configuredKey,
        Action<RateLimiterOptions>? configureRateLimiter = null)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.Configure<SocialAutomationOptions>(options => options.ApiKey = configuredKey);
        services.AddSingleton<ISocialAutomationAuthenticationService, SocialAutomationAuthenticationService>();
        services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtSigningKey)),
                    ValidateIssuer = false,
                    ValidateAudience = false,
                    ValidateLifetime = true,
                    ClockSkew = TimeSpan.FromMinutes(1)
                };
            })
            .AddSocialAutomationKeyAuthentication();
        services.AddAuthorization(options =>
        {
            options.FallbackPolicy = new AuthorizationPolicyBuilder()
                .RequireAuthenticatedUser()
                .Build();
            options.AddSocialAutomationAccessPolicy();
        });
        services.AddRateLimiter(options =>
        {
            if (configureRateLimiter is not null)
                configureRateLimiter(options);
        });

        return services.BuildServiceProvider();
    }
}
