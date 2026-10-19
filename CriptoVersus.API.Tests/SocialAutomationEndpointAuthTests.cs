using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using CriptoVersus.API.Controllers;
using CriptoVersus.API.Services;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace CriptoVersus.API.Tests;

public sealed class SocialAutomationEndpointAuthTests
{
    private const string ConfiguredKey = "social-test-key-do-not-use";
    private const string JwtSigningKey = "unit-test-jwt-signing-key-0123456789abcdef";

    private static readonly string[] ProtectedMethods =
    [
        nameof(PriceCrossoverSocialController.GetCandidates),
        nameof(PriceCrossoverSocialController.Reserve),
        nameof(PriceCrossoverSocialController.Confirm),
        nameof(PriceCrossoverSocialController.Release)
    ];

    [Theory]
    [MemberData(nameof(ProtectedMethodData))]
    public async Task ProtectedEndpoints_WithValidSocialKey_AreAllowed(string method)
    {
        var status = await ExecuteRequestAsync(
            EndpointFor(typeof(PriceCrossoverSocialController), method),
            socialKey: ConfiguredKey);

        Assert.Equal(StatusCodes.Status200OK, status);
    }

    [Theory]
    [MemberData(nameof(ProtectedMethodData))]
    public async Task ProtectedEndpoints_WithWrongSocialKey_Return401(string method)
    {
        var status = await ExecuteRequestAsync(
            EndpointFor(typeof(PriceCrossoverSocialController), method),
            socialKey: "chave-incorreta");

        Assert.Equal(StatusCodes.Status401Unauthorized, status);
    }

    [Theory]
    [MemberData(nameof(ProtectedMethodData))]
    public async Task ProtectedEndpoints_WithoutCredentials_Return401(string method)
    {
        var status = await ExecuteRequestAsync(
            EndpointFor(typeof(PriceCrossoverSocialController), method));

        Assert.Equal(StatusCodes.Status401Unauthorized, status);
    }

    [Theory]
    [MemberData(nameof(ProtectedMethodData))]
    public async Task ProtectedEndpoints_WithEmptySocialKey_Return401(string method)
    {
        var status = await ExecuteRequestAsync(
            EndpointFor(typeof(PriceCrossoverSocialController), method),
            socialKey: "");

        Assert.Equal(StatusCodes.Status401Unauthorized, status);
    }

    [Theory]
    [MemberData(nameof(ProtectedMethodData))]
    public async Task ProtectedEndpoints_WithUnconfiguredKey_Return401(string method)
    {
        var status = await ExecuteRequestAsync(
            EndpointFor(typeof(PriceCrossoverSocialController), method),
            configuredKey: null,
            socialKey: "qualquer-chave");

        Assert.Equal(StatusCodes.Status401Unauthorized, status);
    }

    [Theory]
    [MemberData(nameof(ProtectedMethodData))]
    public async Task ProtectedEndpoints_WithValidJwt_AreAllowed(string method)
    {
        var status = await ExecuteRequestAsync(
            EndpointFor(typeof(PriceCrossoverSocialController), method),
            bearerToken: CreateJwt(JwtSigningKey));

        Assert.Equal(StatusCodes.Status200OK, status);
    }

    [Theory]
    [MemberData(nameof(ProtectedMethodData))]
    public async Task ProtectedEndpoints_WithInvalidJwt_Return401(string method)
    {
        var status = await ExecuteRequestAsync(
            EndpointFor(typeof(PriceCrossoverSocialController), method),
            bearerToken: CreateJwt("chave-de-assinatura-divergente-0123456789"));

        Assert.Equal(StatusCodes.Status401Unauthorized, status);
    }

    [Theory]
    [InlineData(nameof(PriceCrossoverSocialController.GetHighlight))]
    [InlineData(nameof(PriceCrossoverSocialController.GetByMatchId))]
    public async Task PublicEndpoints_WithoutCredentials_AreAllowed(string method)
    {
        var status = await ExecuteRequestAsync(
            EndpointFor(typeof(PriceCrossoverSocialController), method));

        Assert.Equal(StatusCodes.Status200OK, status);
    }

    [Fact]
    public async Task UpsertCoinProfile_WithValidSocialKey_IsAllowed()
    {
        var status = await ExecuteRequestAsync(
            EndpointFor(typeof(SocialController), nameof(SocialController.UpsertCoinProfile)),
            socialKey: ConfiguredKey);

        Assert.Equal(StatusCodes.Status200OK, status);
    }

    [Fact]
    public async Task UpsertCoinProfile_WithoutCredentials_Returns401()
    {
        var status = await ExecuteRequestAsync(
            EndpointFor(typeof(SocialController), nameof(SocialController.UpsertCoinProfile)));

        Assert.Equal(StatusCodes.Status401Unauthorized, status);
    }

    [Fact]
    public async Task UpsertCoinProfile_WithWrongSocialKey_Returns401()
    {
        var status = await ExecuteRequestAsync(
            EndpointFor(typeof(SocialController), nameof(SocialController.UpsertCoinProfile)),
            socialKey: "chave-incorreta");

        Assert.Equal(StatusCodes.Status401Unauthorized, status);
    }

    [Fact]
    public async Task UpsertCoinProfile_WithUnconfiguredKey_Returns401()
    {
        var status = await ExecuteRequestAsync(
            EndpointFor(typeof(SocialController), nameof(SocialController.UpsertCoinProfile)),
            configuredKey: null,
            socialKey: "qualquer-chave");

        Assert.Equal(StatusCodes.Status401Unauthorized, status);
    }

    [Fact]
    public async Task UpsertCoinProfile_WithValidJwt_IsAllowed()
    {
        var status = await ExecuteRequestAsync(
            EndpointFor(typeof(SocialController), nameof(SocialController.UpsertCoinProfile)),
            bearerToken: CreateJwt(JwtSigningKey));

        Assert.Equal(StatusCodes.Status200OK, status);
    }

    [Fact]
    public void ProtectedEndpoints_UseSocialAutomationPolicyAndAreNotAnonymous()
    {
        foreach (var method in ProtectedMethods)
        {
            var methodInfo = typeof(PriceCrossoverSocialController).GetMethod(method)!;
            var authorize = methodInfo.GetCustomAttributes(true).OfType<AuthorizeAttribute>().SingleOrDefault();

            Assert.NotNull(authorize);
            Assert.Equal(SocialAutomationDefaults.PolicyName, authorize!.Policy);
            Assert.Null(methodInfo.GetCustomAttributes(true).OfType<AllowAnonymousAttribute>().SingleOrDefault());
        }

        var upsert = typeof(SocialController).GetMethod(nameof(SocialController.UpsertCoinProfile))!;
        var upsertAuthorize = upsert.GetCustomAttributes(true).OfType<AuthorizeAttribute>().SingleOrDefault();
        Assert.NotNull(upsertAuthorize);
        Assert.Equal(SocialAutomationDefaults.PolicyName, upsertAuthorize!.Policy);
        Assert.Null(upsert.GetCustomAttributes(true).OfType<AllowAnonymousAttribute>().SingleOrDefault());
    }

    [Fact]
    public void PublicPriceCrossoverEndpoints_AreAnonymous()
    {
        foreach (var method in new[]
                 {
                     nameof(PriceCrossoverSocialController.GetHighlight),
                     nameof(PriceCrossoverSocialController.GetByMatchId)
                 })
        {
            var methodInfo = typeof(PriceCrossoverSocialController).GetMethod(method)!;
            Assert.NotNull(methodInfo.GetCustomAttributes(true).OfType<AllowAnonymousAttribute>().SingleOrDefault());
        }
    }

    [Fact]
    public async Task Reserve_Duplicate_PreservesIdempotency()
    {
        using var db = PriceCrossoverTestHelpers.CreateDbContext();
        PriceCrossoverTestHelpers.SeedMatch(db, 1);
        var controller = CreatePublicationController(db);

        var first = await controller.Reserve(1, new PriceCrossoverReserveRequest { Owner = "n8n" }, CancellationToken.None);
        Assert.IsType<OkObjectResult>(first.Result);

        var second = await controller.Reserve(1, new PriceCrossoverReserveRequest { Owner = "n8n" }, CancellationToken.None);
        var conflict = Assert.IsType<ConflictObjectResult>(second.Result);
        var payload = Assert.IsType<PriceCrossoverPublicationResult>(conflict.Value);
        Assert.False(payload.Success);
        Assert.Equal("already_reserved", payload.Result);
        Assert.Equal("price_crossover_highlight:1", payload.Publication!.IdempotencyKey);
    }

    public static IEnumerable<object[]> ProtectedMethodData()
        => ProtectedMethods.Select(method => new object[] { method });

    private static PriceCrossoverSocialController CreatePublicationController(EthicAIDbContext db)
    {
        var options = new PriceCrossoverOptions();
        return new PriceCrossoverSocialController(
            PriceCrossoverTestHelpers.CreateSocialService(db, options),
            PriceCrossoverTestHelpers.CreateSelector(db, options),
            new PriceCrossoverPublicationService(db, Options.Create(options)))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext()
            }
        };
    }

    private static Endpoint EndpointFor(Type controller, string method)
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

    private static string CreateJwt(string signingKey, TimeSpan? lifetime = null)
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

    private static async Task<int> ExecuteRequestAsync(
        Endpoint endpoint,
        string? configuredKey = ConfiguredKey,
        string? socialKey = null,
        string? bearerToken = null)
    {
        await using var provider = BuildPipelineProvider(configuredKey);

        var context = new DefaultHttpContext { RequestServices = provider };
        if (socialKey is not null)
            context.Request.Headers[SocialAutomationDefaults.HeaderName] = socialKey;
        if (bearerToken is not null)
            context.Request.Headers.Authorization = $"Bearer {bearerToken}";
        context.SetEndpoint(endpoint);

        RequestDelegate terminal = httpContext =>
        {
            httpContext.Response.StatusCode = StatusCodes.Status200OK;
            return Task.CompletedTask;
        };

        var authorization = new AuthorizationMiddleware(
            terminal,
            provider.GetRequiredService<IAuthorizationPolicyProvider>());
        var authentication = new AuthenticationMiddleware(
            authorization.Invoke,
            provider.GetRequiredService<IAuthenticationSchemeProvider>());

        await authentication.Invoke(context);
        return context.Response.StatusCode;
    }

    private static ServiceProvider BuildPipelineProvider(string? configuredKey)
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

        return services.BuildServiceProvider();
    }
}
