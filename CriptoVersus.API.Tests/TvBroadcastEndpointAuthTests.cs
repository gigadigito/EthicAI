using CriptoVersus.API.Controllers;
using CriptoVersus.API.Services;
using DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using static CriptoVersus.API.Tests.ApiAuthorizationTestHarness;

namespace CriptoVersus.API.Tests;

/// <summary>
/// Contrato de acesso dos endpoints publicos de transmissao da Candle Battle TV: os dois GETs
/// aceitam requisicoes anonimas (o transmissor externo nao possui JWT), com rate limit proprio,
/// enquanto todo o restante da API mantem a fallback policy exigindo autenticacao.
/// </summary>
public sealed class TvBroadcastEndpointAuthTests
{
    private static readonly string[] BroadcastMethods =
    [
        nameof(TvController.GetNextCandleBattle),
        nameof(TvController.GetCandleBattleBroadcastStatus)
    ];

    private static readonly string[] ProtectedMethods =
    [
        nameof(PriceCrossoverSocialController.GetCandidates),
        nameof(PriceCrossoverSocialController.Reserve),
        nameof(PriceCrossoverSocialController.Confirm),
        nameof(PriceCrossoverSocialController.Release),
        nameof(SocialController.UpsertCoinProfile)
    ];

    // Acesso anonimo aos endpoints do transmissor.

    [Theory]
    [InlineData(nameof(TvController.GetNextCandleBattle))]
    [InlineData(nameof(TvController.GetCandleBattleBroadcastStatus))]
    public async Task BroadcastEndpoints_WithoutCredentials_AreAllowed(string method)
    {
        var status = await ExecuteRequestAsync(EndpointFor(typeof(TvController), method));

        Assert.Equal(StatusCodes.Status200OK, status);
    }

    [Theory]
    [InlineData(nameof(TvController.GetNextCandleBattle))]
    [InlineData(nameof(TvController.GetCandleBattleBroadcastStatus))]
    public async Task BroadcastEndpoints_WithInvalidJwt_AreAllowed(string method)
    {
        // Um token invalido nao reativa a protecao: o endpoint e publico por decisao explicita.
        var status = await ExecuteRequestAsync(
            EndpointFor(typeof(TvController), method),
            bearerToken: CreateJwt("chave-de-assinatura-divergente-0123456789"));

        Assert.Equal(StatusCodes.Status200OK, status);
    }

    // Metadados: somente os dois GETs do transmissor mudam; nada mais foi alterado.

    [Fact]
    public void BroadcastEndpoints_AreAnonymousGetOnlyAndRateLimited()
    {
        foreach (var method in BroadcastMethods)
        {
            var methodInfo = typeof(TvController).GetMethod(method)!;

            Assert.NotNull(methodInfo.GetCustomAttributes(typeof(AllowAnonymousAttribute), false).SingleOrDefault());
            Assert.Empty(methodInfo.GetCustomAttributes(typeof(AuthorizeAttribute), false));
            Assert.NotNull(methodInfo.GetCustomAttributes(typeof(HttpGetAttribute), false).SingleOrDefault());
            Assert.Empty(methodInfo.GetCustomAttributes(typeof(HttpPostAttribute), false));
            Assert.Empty(methodInfo.GetCustomAttributes(typeof(HttpPutAttribute), false));
            Assert.Empty(methodInfo.GetCustomAttributes(typeof(HttpDeleteAttribute), false));
            Assert.Empty(methodInfo.GetCustomAttributes(typeof(HttpPatchAttribute), false));
            Assert.Equal(TvBroadcastRateLimiter.PolicyName,
                Assert.Single(methodInfo.GetCustomAttributes(true).OfType<EnableRateLimitingAttribute>()).PolicyName);
        }

        // O TvController inteiro nao recebeu [Authorize] nem politica global nova.
        Assert.Empty(typeof(TvController).GetCustomAttributes(typeof(AuthorizeAttribute), false));
    }

    [Fact]
    public void OtherTvControllerEndpoints_RemainUnchanged()
    {
        foreach (var method in new[] { nameof(TvController.GetHotMatch), nameof(TvController.GenerateNarration) })
        {
            var methodInfo = typeof(TvController).GetMethod(method)!;
            Assert.NotNull(methodInfo.GetCustomAttributes(typeof(AllowAnonymousAttribute), false).SingleOrDefault());
            Assert.Empty(methodInfo.GetCustomAttributes(typeof(EnableRateLimitingAttribute), false));
        }
    }

    [Fact]
    public async Task OtherTvControllerEndpoints_WithoutCredentials_RemainAllowed()
    {
        Assert.Equal(StatusCodes.Status200OK,
            await ExecuteRequestAsync(EndpointFor(typeof(TvController), nameof(TvController.GetHotMatch))));
        Assert.Equal(StatusCodes.Status200OK,
            await ExecuteRequestAsync(EndpointFor(typeof(TvController), nameof(TvController.GenerateNarration))));
    }

    // Autorizacao preservada nos demais endpoints da API.

    [Theory]
    [InlineData(nameof(PriceCrossoverSocialController.GetCandidates))]
    [InlineData(nameof(PriceCrossoverSocialController.Reserve))]
    [InlineData(nameof(PriceCrossoverSocialController.Confirm))]
    [InlineData(nameof(PriceCrossoverSocialController.Release))]
    [InlineData(nameof(SocialController.UpsertCoinProfile))]
    public async Task ProtectedEndpoints_WithoutCredentials_StillReturn401(string method)
    {
        var status = await ExecuteRequestAsync(EndpointFor(ControllerFor(method), method));

        Assert.Equal(StatusCodes.Status401Unauthorized, status);
    }

    [Fact]
    public void ProtectedEndpointsElsewhere_KeepTheirPolicyAndAreNotAnonymous()
    {
        foreach (var method in ProtectedMethods)
        {
            var methodInfo = ControllerFor(method).GetMethod(method)!;

            var authorize = methodInfo.GetCustomAttributes(true).OfType<AuthorizeAttribute>().SingleOrDefault();
            Assert.NotNull(authorize);
            Assert.Equal(SocialAutomationDefaults.PolicyName, authorize!.Policy);
            Assert.Null(methodInfo.GetCustomAttributes(true).OfType<AllowAnonymousAttribute>().SingleOrDefault());
            Assert.Empty(methodInfo.GetCustomAttributes(typeof(EnableRateLimitingAttribute), false));
        }
    }

    // A fallback policy continua desafiando qualquer requisicao sem endpoint casado (401),
    // exatamente o comportamento observado em producao para rotas ainda nao publicadas.

    [Fact]
    public async Task UnmatchedRoute_IsChallengedByTheFallbackPolicy()
    {
        var status = await ExecuteRequestAsync(endpoint: null);

        Assert.Equal(StatusCodes.Status401Unauthorized, status);
    }

    // Controle de abuso do acesso anonimo: janela fixa por IP, 429 com Retry-After.

    [Theory]
    [InlineData(nameof(TvController.GetNextCandleBattle))]
    [InlineData(nameof(TvController.GetCandleBattleBroadcastStatus))]
    public async Task BroadcastEndpoints_BurstOverTheLimit_Returns429WithRetryAfter(string method)
    {
        await using var provider = BuildPipelineProvider(ConfiguredKey,
            options => options.AddTvBroadcastRateLimiting(permitLimit: 2));
        var pipeline = BuildPipeline(provider, withRateLimiter: true);
        var endpoint = EndpointFor(typeof(TvController), method);

        for (var i = 0; i < 2; i++)
        {
            var allowed = CreateRequestContext(provider, endpoint, remoteIp: "203.0.113.10");
            await pipeline(allowed);
            Assert.Equal(StatusCodes.Status200OK, allowed.Response.StatusCode);
        }

        var rejected = CreateRequestContext(provider, endpoint, remoteIp: "203.0.113.10");
        await pipeline(rejected);
        Assert.Equal(StatusCodes.Status429TooManyRequests, rejected.Response.StatusCode);
        Assert.Equal("60", rejected.Response.Headers.RetryAfter.ToString());

        // Outro IP nao herda o consumo do primeiro.
        var otherIp = CreateRequestContext(provider, endpoint, remoteIp: "203.0.113.11");
        await pipeline(otherIp);
        Assert.Equal(StatusCodes.Status200OK, otherIp.Response.StatusCode);
    }

    // Respostas publicas nao expoem segredos, credenciais ou dados administrativos.

    [Fact]
    public void BroadcastDtos_ExposeOnlyPublicMatchData()
    {
        var sensitiveTerms = new[] { "key", "secret", "token", "password", "wallet", "email" };
        var properties = typeof(CandleBattleBroadcastSelectionDto).GetProperties()
            .Concat(typeof(CandleBattleBroadcastStatusDto).GetProperties());

        foreach (var property in properties)
        foreach (var term in sensitiveTerms)
            Assert.DoesNotContain(term, property.Name, StringComparison.OrdinalIgnoreCase);
    }

    private static Type ControllerFor(string method)
        => method == nameof(SocialController.UpsertCoinProfile)
            ? typeof(SocialController)
            : typeof(PriceCrossoverSocialController);
}
