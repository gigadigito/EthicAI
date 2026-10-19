using CriptoVersus.API.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Tests;

public sealed class SocialAutomationAuthenticationTests
{
    private const string ConfiguredKey = "social-test-key-do-not-use";

    [Theory]
    [InlineData(ConfiguredKey, ConfiguredKey, true)]
    [InlineData(ConfiguredKey, "chave-incorreta", false)]
    [InlineData(ConfiguredKey, "", false)]
    [InlineData(ConfiguredKey, "   ", false)]
    [InlineData(ConfiguredKey, null, false)]
    [InlineData("", "qualquer-chave", false)]
    [InlineData("   ", "qualquer-chave", false)]
    [InlineData(null, "qualquer-chave", false)]
    [InlineData(null, null, false)]
    [InlineData("", "", false)]
    public void IsValidKey_FailsClosed(string? configuredKey, string? providedKey, bool expected)
    {
        var service = CreateService(configuredKey);

        Assert.Equal(expected, service.IsValidKey(providedKey));
    }

    [Fact]
    public void IsValidKey_TrimsSurroundingWhitespace()
    {
        var service = CreateService($"  {ConfiguredKey}  ");

        Assert.True(service.IsValidKey(ConfiguredKey));
        Assert.True(service.IsValidKey($" {ConfiguredKey} "));
    }

    [Fact]
    public void HasValidKey_ReadsHeaderAndRejectsMissingHeader()
    {
        var service = CreateService(ConfiguredKey);

        var withHeader = new DefaultHttpContext();
        withHeader.Request.Headers[SocialAutomationDefaults.HeaderName] = ConfiguredKey;
        Assert.True(service.HasValidKey(withHeader.Request));

        var withoutHeader = new DefaultHttpContext();
        Assert.False(service.HasValidKey(withoutHeader.Request));

        var emptyHeader = new DefaultHttpContext();
        emptyHeader.Request.Headers[SocialAutomationDefaults.HeaderName] = "";
        Assert.False(service.HasValidKey(emptyHeader.Request));
    }

    [Theory]
    [InlineData("")]
    [InlineData("chave-incorreta")]
    public async Task Scheme_InvalidKey_DoesNotAuthenticate(string providedKey)
    {
        await using var provider = BuildProvider(ConfiguredKey);
        var context = CreateContext(provider, request =>
            request.Headers[SocialAutomationDefaults.HeaderName] = providedKey);

        var result = await context.AuthenticateAsync(SocialAutomationDefaults.AuthenticationScheme);

        Assert.False(result.Succeeded);
        Assert.Null(result.Principal);
    }

    [Fact]
    public async Task Scheme_MissingKeyHeader_DoesNotAuthenticate()
    {
        await using var provider = BuildProvider(ConfiguredKey);
        var context = CreateContext(provider, _ => { });

        var result = await context.AuthenticateAsync(SocialAutomationDefaults.AuthenticationScheme);

        Assert.False(result.Succeeded);
        Assert.Null(result.Principal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Scheme_UnconfiguredKey_NeverAuthenticates(string? configuredKey)
    {
        await using var provider = BuildProvider(configuredKey);
        var context = CreateContext(provider, request =>
            request.Headers[SocialAutomationDefaults.HeaderName] = "qualquer-chave");

        var result = await context.AuthenticateAsync(SocialAutomationDefaults.AuthenticationScheme);

        Assert.False(result.Succeeded);
        Assert.Null(result.Principal);
    }

    [Fact]
    public async Task Scheme_ValidKey_AuthenticatesSocialAutomationPrincipal()
    {
        await using var provider = BuildProvider(ConfiguredKey);
        var context = CreateContext(provider, request =>
            request.Headers[SocialAutomationDefaults.HeaderName] = ConfiguredKey);

        var result = await context.AuthenticateAsync(SocialAutomationDefaults.AuthenticationScheme);

        Assert.True(result.Succeeded);
        Assert.Equal(SocialAutomationDefaults.PrincipalName, result.Principal?.Identity?.Name);
        Assert.Equal(SocialAutomationDefaults.AuthenticationScheme, result.Principal?.Identity?.AuthenticationType);
    }

    [Fact]
    public async Task Authentication_NeverWritesKeyMaterialToLogs()
    {
        var capture = new CapturingLoggerProvider();
        await using var provider = BuildProvider(ConfiguredKey, capture);
        var attackerKey = "chave-invasora-visivel-em-log";

        var valid = CreateContext(provider, request =>
            request.Headers[SocialAutomationDefaults.HeaderName] = ConfiguredKey);
        await valid.AuthenticateAsync(SocialAutomationDefaults.AuthenticationScheme);

        var invalid = CreateContext(provider, request =>
            request.Headers[SocialAutomationDefaults.HeaderName] = attackerKey);
        await invalid.AuthenticateAsync(SocialAutomationDefaults.AuthenticationScheme);

        var missing = CreateContext(provider, _ => { });
        await missing.AuthenticateAsync(SocialAutomationDefaults.AuthenticationScheme);

        provider.GetRequiredService<ILoggerFactory>()
            .CreateLogger("Sanity")
            .LogInformation("registro-de-controle");

        Assert.NotEmpty(capture.Entries);
        Assert.Contains(capture.Entries, entry => entry.Contains("registro-de-controle"));
        Assert.DoesNotContain(capture.Entries, entry => entry.Contains(ConfiguredKey));
        Assert.DoesNotContain(capture.Entries, entry => entry.Contains(attackerKey));
    }

    private static ISocialAutomationAuthenticationService CreateService(string? configuredKey)
        => new SocialAutomationAuthenticationService(
            Options.Create(new SocialAutomationOptions { ApiKey = configuredKey }));

    private static ServiceProvider BuildProvider(string? configuredKey, ILoggerProvider? loggerProvider = null)
    {
        var services = new ServiceCollection();
        services.AddLogging(builder =>
        {
            builder.SetMinimumLevel(LogLevel.Trace);
            if (loggerProvider is not null)
                builder.AddProvider(loggerProvider);
        });
        services.Configure<SocialAutomationOptions>(options => options.ApiKey = configuredKey);
        services.AddSingleton<ISocialAutomationAuthenticationService, SocialAutomationAuthenticationService>();
        services.AddAuthentication(SocialAutomationDefaults.AuthenticationScheme)
            .AddSocialAutomationKeyAuthentication();

        return services.BuildServiceProvider();
    }

    private static DefaultHttpContext CreateContext(ServiceProvider provider, Action<HttpRequest> configureRequest)
    {
        var context = new DefaultHttpContext { RequestServices = provider };
        configureRequest(context.Request);
        return context;
    }

    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        public List<string> Entries { get; } = [];

        public ILogger CreateLogger(string categoryName) => new CapturingLogger(Entries);

        public void Dispose()
        {
        }

        private sealed class CapturingLogger(List<string> entries) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter)
            {
                lock (entries)
                {
                    entries.Add(formatter(state, exception));
                    if (exception is not null)
                        entries.Add(exception.ToString());
                }
            }
        }
    }
}
