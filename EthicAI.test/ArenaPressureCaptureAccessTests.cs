using CriptoVersus.Web.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

namespace EthicAI.test;

public sealed class ArenaPressureCaptureAccessTests
{
    [Fact]
    public void Development_AllowsLocalCaptureWithoutKey()
    {
        var configuration = Configuration([]);
        var environment = new TestEnvironment(Environments.Development);

        Assert.True(ArenaPressureCaptureAccess.IsEnabled(environment, configuration));
        Assert.True(ArenaPressureCaptureAccess.IsAuthorized(
            new DefaultHttpContext(), environment, configuration));
    }

    [Fact]
    public void Production_IsDisabledByDefault()
    {
        var configuration = Configuration([]);
        var environment = new TestEnvironment(Environments.Production);

        Assert.False(ArenaPressureCaptureAccess.IsEnabled(environment, configuration));
        Assert.False(ArenaPressureCaptureAccess.IsAuthorized(
            new DefaultHttpContext(), environment, configuration));
    }

    [Fact]
    public void Production_FailsClosedWithoutConfiguredKey()
    {
        var configuration = Configuration(new Dictionary<string, string?>
        {
            [ArenaPressureCaptureAccess.EnabledKey] = "true"
        });
        var environment = new TestEnvironment(Environments.Production);
        var context = new DefaultHttpContext();
        context.Request.Headers[ArenaPressureCaptureAccess.HeaderName] = "provided-key";

        Assert.True(ArenaPressureCaptureAccess.IsEnabled(environment, configuration));
        Assert.False(ArenaPressureCaptureAccess.IsAuthorized(context, environment, configuration));
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("wrong", false)]
    [InlineData("capture-test-key", true)]
    public void Production_RequiresExactHeader(string? supplied, bool expected)
    {
        var configuration = Configuration(new Dictionary<string, string?>
        {
            [ArenaPressureCaptureAccess.EnabledKey] = "true",
            [ArenaPressureCaptureAccess.AccessKey] = "capture-test-key"
        });
        var environment = new TestEnvironment(Environments.Production);
        var context = new DefaultHttpContext();
        if (supplied is not null)
            context.Request.Headers[ArenaPressureCaptureAccess.HeaderName] = supplied;

        Assert.Equal(expected,
            ArenaPressureCaptureAccess.IsAuthorized(context, environment, configuration));
    }

    private static IConfiguration Configuration(IEnumerable<KeyValuePair<string, string?>> values)
        => new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    private sealed class TestEnvironment(string environmentName) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = environmentName;
        public string ApplicationName { get; set; } = "Tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
