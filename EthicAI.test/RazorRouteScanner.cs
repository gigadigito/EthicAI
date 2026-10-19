using System.Text.RegularExpressions;

namespace EthicAI.test;

internal sealed record RazorPageRoute(string Template, string FilePath);

internal static class RazorRouteScanner
{
    private static readonly Regex PageDirective = new("^\\s*@page\\s+\"([^\"]+)\"", RegexOptions.Compiled | RegexOptions.Multiline);

    public static string FindCriptoVersusRoot()
    {
        foreach (var start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
        {
            var current = new DirectoryInfo(start);
            while (current is not null)
            {
                var candidate = Path.Combine(current.FullName, "CriptoVersus", "Components", "Pages");
                if (Directory.Exists(candidate))
                    return current.FullName;

                current = current.Parent;
            }
        }

        throw new InvalidOperationException("Nao foi possivel localizar a raiz do repositorio com CriptoVersus/Components/Pages.");
    }

    public static IReadOnlyList<RazorPageRoute> GetPageRoutes()
    {
        var root = FindCriptoVersusRoot();
        var pagesRoot = Path.Combine(root, "CriptoVersus", "Components");

        return Directory
            .GetFiles(pagesRoot, "*.razor", SearchOption.AllDirectories)
            .SelectMany(file => PageDirective.Matches(File.ReadAllText(file))
                .Select(match => new RazorPageRoute(match.Groups[1].Value, file)))
            .ToArray();
    }

    public static IReadOnlyList<string> GetPageRouteTemplates()
        => GetPageRoutes().Select(route => route.Template).ToArray();
}
