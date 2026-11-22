namespace EthicAI.test;

public sealed class JavaScriptModulePathTests
{
    [Theory]
    [InlineData("https://criptoversus.com/")]
    [InlineData("https://criptoversus.com/en/tv/pressure/46156")]
    [InlineData("https://criptoversus.com/pt-BR/matches/46156/example")]
    public void WalletActionsModule_ResolvesFromApplicationRoot(string pageUrl)
    {
        var resolved = new Uri(new Uri(pageUrl), "/js/solanaWalletActions.js?v=test");

        Assert.Equal("https://criptoversus.com/js/solanaWalletActions.js?v=test", resolved.AbsoluteUri);
    }

    [Fact]
    public void Components_DoNotUseRouteRelativeJavaScriptModulePaths()
    {
        var componentsPath = Path.Combine(FindRepositoryRoot(), "CriptoVersus", "Components");
        var sourceFiles = Directory.EnumerateFiles(componentsPath, "*.razor", SearchOption.AllDirectories)
            .Concat(Directory.EnumerateFiles(componentsPath, "*.razor.cs", SearchOption.AllDirectories));

        var offenders = sourceFiles
            .Where(path => File.ReadAllText(path).Contains("\"./js/", StringComparison.Ordinal))
            .Select(path => Path.GetRelativePath(componentsPath, path))
            .ToArray();

        Assert.Empty(offenders);
    }

    private static string FindRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "CriptoVersus")))
            directory = directory.Parent;

        return directory?.FullName
            ?? throw new DirectoryNotFoundException("CriptoVersus repository root was not found.");
    }
}
