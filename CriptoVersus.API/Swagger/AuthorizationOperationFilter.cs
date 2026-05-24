using Microsoft.AspNetCore.Authorization;
using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace CriptoVersus.API.Swagger;

public sealed class AuthorizationOperationFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        var hasAllowAnonymous = context.MethodInfo.DeclaringType?.GetCustomAttributes(true).OfType<AllowAnonymousAttribute>().Any() == true
            || context.MethodInfo.GetCustomAttributes(true).OfType<AllowAnonymousAttribute>().Any();

        if (hasAllowAnonymous)
            operation.Security = [];

        if (string.Equals(context.MethodInfo.Name, "UpsertCoinProfile", StringComparison.Ordinal))
        {
            operation.Parameters ??= [];
            operation.Parameters.Add(new OpenApiParameter
            {
                Name = "X-Social-Key",
                In = ParameterLocation.Header,
                Required = false,
                Description = "Header opcional para automacao n8n. Se SocialAutomation:ApiKey estiver configurada, chamadas anonimas devem enviar esse valor.",
                Schema = new OpenApiSchema
                {
                    Type = "string"
                }
            });
        }
    }
}
