using CriptoVersus.API.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Tests;

public sealed class MoneyFlowTransportTests
{
    [Fact]
    public void WorkerAuthentication_UsesConfiguredKeyAndRejectsMissingOrWrongKey()
    {
        var service = new MoneyFlowWorkerAuthenticationService(
            Options.Create(new MoneyFlowTransportOptions { WorkerApiKey = "development-only-key" }));
        var context = new DefaultHttpContext();

        Assert.False(service.IsAuthorized(context.Request));
        context.Request.Headers[MoneyFlowWorkerAuthenticationService.HeaderName] = "wrong";
        Assert.False(service.IsAuthorized(context.Request));
        context.Request.Headers[MoneyFlowWorkerAuthenticationService.HeaderName] = " development-only-key ";
        Assert.True(service.IsAuthorized(context.Request));
    }

    [Fact]
    public void WorkerAuthentication_FailsClosedWhenKeyIsNotConfigured()
    {
        var service = new MoneyFlowWorkerAuthenticationService(
            Options.Create(new MoneyFlowTransportOptions { WorkerApiKey = "" }));
        var context = new DefaultHttpContext();
        context.Request.Headers[MoneyFlowWorkerAuthenticationService.HeaderName] = "anything";

        Assert.False(service.IsAuthorized(context.Request));
    }

    [Fact]
    public void Options_KeepTransportDisabledByDefaultAndValidateBoundedLimits()
    {
        var options = new MoneyFlowTransportOptions();
        Assert.False(options.Enabled);
        Assert.False(options.TransportEnabled);
        Assert.Same(options, options.Validate());
        Assert.Throws<InvalidOperationException>(() => new MoneyFlowTransportOptions { QueueCapacity = 0 }.Validate());
    }
}
