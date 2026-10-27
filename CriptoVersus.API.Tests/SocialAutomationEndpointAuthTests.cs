using CriptoVersus.API.Controllers;
using CriptoVersus.API.Services;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using static CriptoVersus.API.Tests.ApiAuthorizationTestHarness;

namespace CriptoVersus.API.Tests;

public sealed class SocialAutomationEndpointAuthTests
{
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
}
