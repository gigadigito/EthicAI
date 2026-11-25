using CriptoVersus.API.Controllers;
using CriptoVersus.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using static CriptoVersus.API.Tests.ApiAuthorizationTestHarness;

namespace CriptoVersus.API.Tests;

public sealed class ArenaPressureRankingEndpointAuthTests
{
    private static readonly Endpoint RankingEndpoint = EndpointFor(
        typeof(ArenaPressureRankingController),
        nameof(ArenaPressureRankingController.GetToday));

    [Fact]
    public async Task GetToday_WithValidJwt_IsAllowed()
    {
        var status = await ExecuteRequestAsync(
            RankingEndpoint,
            bearerToken: CreateJwt(JwtSigningKey));

        Assert.Equal(StatusCodes.Status200OK, status);
    }

    [Fact]
    public async Task GetToday_WithValidSocialKey_IsAllowed()
    {
        var status = await ExecuteRequestAsync(RankingEndpoint, socialKey: ConfiguredKey);

        Assert.Equal(StatusCodes.Status200OK, status);
    }

    [Fact]
    public async Task GetToday_WithoutCredentials_Returns401()
    {
        var status = await ExecuteRequestAsync(RankingEndpoint);

        Assert.Equal(StatusCodes.Status401Unauthorized, status);
    }

    [Fact]
    public async Task GetToday_WithWrongSocialKey_Returns401()
    {
        var status = await ExecuteRequestAsync(RankingEndpoint, socialKey: "chave-incorreta");

        Assert.Equal(StatusCodes.Status401Unauthorized, status);
    }

    [Fact]
    public async Task GetToday_WithUnconfiguredSocialKey_Returns401()
    {
        var status = await ExecuteRequestAsync(
            RankingEndpoint,
            configuredKey: null,
            socialKey: "qualquer-chave");

        Assert.Equal(StatusCodes.Status401Unauthorized, status);
    }

    [Fact]
    public void GetToday_UsesSocialAutomationPolicyAndIsNotAnonymous()
    {
        var method = typeof(ArenaPressureRankingController)
            .GetMethod(nameof(ArenaPressureRankingController.GetToday))!;
        var authorize = method.GetCustomAttributes(true).OfType<AuthorizeAttribute>().SingleOrDefault();

        Assert.NotNull(authorize);
        Assert.Equal(SocialAutomationDefaults.PolicyName, authorize!.Policy);
        Assert.Null(method.GetCustomAttributes(true).OfType<AllowAnonymousAttribute>().SingleOrDefault());
    }
}
