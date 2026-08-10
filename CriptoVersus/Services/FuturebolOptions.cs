namespace CriptoVersus.Web.Services;

public sealed class FuturebolOptions
{
    public const string SectionName = "Futurebol";

    public bool Enabled { get; set; }

    public string DataMode { get; set; } = "Mock";

    public string DefaultHomeSymbol { get; set; } = "BTC";

    public string DefaultAwaySymbol { get; set; } = "ETH";
}
