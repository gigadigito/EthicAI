using System.Net;
using CriptoVersus.API.Controllers;
using CriptoVersus.API.Services;
using DTOs;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;

namespace CriptoVersus.API.Tests;

public sealed class CommunityMatchesControllerTests
{
    [Fact]
    public async Task CreateCommunityMatch_WhenCreated_Returns201()
    {
        var controller = CreateController(new FakeCommunityMatchService(new CommunityMatchServiceResult(
            HttpStatusCode.OK,
            new CommunityMatchCreateResponseDto { Created = true, MessageCode = "battleCreatedSuccessfully", Message = "battleCreatedSuccessfully" },
            "battleCreatedSuccessfully",
            "battleCreatedSuccessfully")));

        var action = await controller.CreateCommunityMatch(new CommunityMatchCreateRequestDto(), CancellationToken.None);

        var result = Assert.IsType<ObjectResult>(action.Result);
        Assert.Equal(StatusCodes.Status201Created, result.StatusCode);
    }

    [Fact]
    public async Task CreateCommunityMatch_WhenExisting_Returns200()
    {
        var controller = CreateController(new FakeCommunityMatchService(new CommunityMatchServiceResult(
            HttpStatusCode.OK,
            new CommunityMatchCreateResponseDto { Created = false, AlreadyExists = true, MessageCode = "battleAlreadyExists", Message = "battleAlreadyExists" },
            "battleAlreadyExists",
            "battleAlreadyExists")));

        var action = await controller.CreateCommunityMatch(new CommunityMatchCreateRequestDto(), CancellationToken.None);

        var result = Assert.IsType<OkObjectResult>(action.Result);
        Assert.Equal(StatusCodes.Status200OK, result.StatusCode);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest, StatusCodes.Status400BadRequest)]
    [InlineData(HttpStatusCode.Forbidden, StatusCodes.Status403Forbidden)]
    [InlineData(HttpStatusCode.Conflict, StatusCodes.Status409Conflict)]
    [InlineData(HttpStatusCode.ServiceUnavailable, StatusCodes.Status503ServiceUnavailable)]
    public async Task CreateCommunityMatch_WhenRejected_ReturnsExpectedStatus(HttpStatusCode statusCode, int expectedStatus)
    {
        var controller = CreateController(new FakeCommunityMatchService(new CommunityMatchServiceResult(
            statusCode,
            null,
            "messageCode",
            "detail")));

        var action = await controller.CreateCommunityMatch(new CommunityMatchCreateRequestDto(), CancellationToken.None);

        var result = Assert.IsType<ObjectResult>(action.Result);
        Assert.Equal(expectedStatus, result.StatusCode);
    }

    [Fact]
    public async Task CreateCommunityMatch_WhenTooManyRequests_SetsRetryAfterHeader()
    {
        var controller = CreateController(new FakeCommunityMatchService(new CommunityMatchServiceResult(
            HttpStatusCode.TooManyRequests,
            null,
            "tooManyRequests",
            "detail",
            RetryAfterSeconds: 45)));

        var action = await controller.CreateCommunityMatch(new CommunityMatchCreateRequestDto(), CancellationToken.None);

        var result = Assert.IsType<ObjectResult>(action.Result);
        Assert.Equal(StatusCodes.Status429TooManyRequests, result.StatusCode);
        Assert.Equal("45", controller.Response.Headers.RetryAfter.ToString());
    }

    private static CommunityMatchesController CreateController(ICommunityMatchService service)
    {
        var controller = new CommunityMatchesController(service, NullLogger<CommunityMatchesController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext()
            }
        };

        return controller;
    }

    private sealed class FakeCommunityMatchService : ICommunityMatchService
    {
        private readonly CommunityMatchServiceResult _result;

        public FakeCommunityMatchService(CommunityMatchServiceResult result)
        {
            _result = result;
        }

        public Task<CommunityMatchServiceResult> CreateAsync(CommunityMatchCreateRequestDto request, System.Security.Claims.ClaimsPrincipal? user, string? remoteIpAddress, CancellationToken ct = default)
            => Task.FromResult(_result);
    }
}

