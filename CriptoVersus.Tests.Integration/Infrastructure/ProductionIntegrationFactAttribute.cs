namespace CriptoVersus.Tests.Integration.Infrastructure;

[AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
public sealed class ProductionIntegrationFactAttribute : FactAttribute
{
    public ProductionIntegrationFactAttribute()
    {
        try
        {
            var settings = IntegrationTestSettings.Load();
            if (!settings.RunProductionIntegrationTests)
            {
                Skip = "Defina CriptoVersusApi__RunProductionIntegrationTests=true para executar testes contra a API real.";
                return;
            }

            if (string.IsNullOrWhiteSpace(settings.TestApiKey))
                Skip = "Defina CriptoVersusApi__TestApiKey para habilitar os endpoints internos protegidos.";
        }
        catch (Exception ex)
        {
            Skip = $"Configuracao invalida para testes de integracao: {ex.Message}";
        }
    }
}
