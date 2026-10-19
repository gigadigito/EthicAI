using CriptoVersus.API.Controllers;
using CriptoVersus.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace CriptoVersus.API.Swagger;

public sealed class AuthorizationOperationFilter : IOperationFilter
{
    private static readonly HashSet<(Type Controller, string Method)> SocialKeyEndpoints =
    [
        (typeof(PriceCrossoverSocialController), nameof(PriceCrossoverSocialController.GetCandidates)),
        (typeof(PriceCrossoverSocialController), nameof(PriceCrossoverSocialController.Reserve)),
        (typeof(PriceCrossoverSocialController), nameof(PriceCrossoverSocialController.Confirm)),
        (typeof(PriceCrossoverSocialController), nameof(PriceCrossoverSocialController.Release)),
        (typeof(SocialController), nameof(SocialController.UpsertCoinProfile))
    ];

    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        var hasAllowAnonymous = context.MethodInfo.DeclaringType?.GetCustomAttributes(true).OfType<AllowAnonymousAttribute>().Any() == true
            || context.MethodInfo.GetCustomAttributes(true).OfType<AllowAnonymousAttribute>().Any();

        if (hasAllowAnonymous)
            operation.Security = [];

        if (context.MethodInfo.DeclaringType is { } controller &&
            SocialKeyEndpoints.Contains((controller, context.MethodInfo.Name)))
        {
            operation.Parameters ??= [];
            operation.Parameters.Add(new OpenApiParameter
            {
                Name = SocialAutomationDefaults.HeaderName,
                In = ParameterLocation.Header,
                Required = false,
                Description = "Header para automacao n8n. Alternativa ao JWT Bearer para a politica " +
                    SocialAutomationDefaults.PolicyName +
                    ". Exige SocialAutomation:ApiKey configurada na API; a chave nunca e aceita vazia.",
                Schema = new OpenApiSchema
                {
                    Type = "string"
                }
            });
        }
    }
}
