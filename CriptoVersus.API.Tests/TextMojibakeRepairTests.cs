using System.Text;
using DTOs;

namespace CriptoVersus.API.Tests;

public sealed class TextMojibakeRepairTests
{
    static TextMojibakeRepairTests()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
    }

    [Theory]
    [InlineData("MANA mesmo sem posse de bola protege bem a sua área.")]
    [InlineData("KITE abriu domínio no Candle Battle.")]
    [InlineData("XPL manteve pressão e buscou reação.")]
    [InlineData("Diferença de valorização igual ou superior a 2%.")]
    [InlineData("Não é aconselhamento financeiro.")]
    [InlineData("Último golpe aos 52'.")]
    public void Normalize_RebuildsCommonPortuguesePhrases(string expected)
    {
        var input = ToMojibake(expected);
        var actual = TextMojibakeRepair.Normalize(input);

        Assert.Equal(expected, actual);
        Assert.False(TextMojibakeRepair.LooksLikeMojibake(actual));
    }

    [Theory]
    [InlineData("MANA protege bem a sua área.")]
    [InlineData("VARIAÇÃO 5M")]
    public void Normalize_DoesNotChangeAlreadyCorrectText(string value)
    {
        var actual = TextMojibakeRepair.Normalize(value);

        Assert.Equal(value, actual);
    }

    private static string ToMojibake(string value)
        => Encoding.GetEncoding(1252).GetString(Encoding.UTF8.GetBytes(value));
}
