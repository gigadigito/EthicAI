namespace EthicAI.Helpers
{
    public class URL
    {
        public static string GenerateUrlFriendlyTitle(string title, int maxLength = 50)
        {
            if (string.IsNullOrEmpty(title))
                return string.Empty;

            // Converte o título em um URL amigável
            string urlFriendlyTitle = title
                .ToLowerInvariant()
                .Replace(" ", "-")            // substitui espaços por hífens
                .Replace("ç", "c")
                .Replace("á", "a")
                .Replace("é", "e")
                .Replace("í", "i")
                .Replace("ó", "o")
                .Replace("ú", "u")
                .Replace("ã", "a")
                .Replace("õ", "o")
                .Replace("ê", "e")
                .Replace("â", "a")
                .Replace("ô", "o")
                .Replace("ü", "u")
                .Replace("!", "")
                .Replace("?", "")
                .Replace(".", "")
                .Replace(",", "")
                .Replace("/", "")
                .Replace("\\", "")
                .Replace(":", "")
                .Replace(";", "")
                .Replace("'", "")
                .Replace("\"", "")
                .Replace("&", "and");

            // Limita o número de caracteres ao máximo especificado
            if (urlFriendlyTitle.Length > maxLength)
            {
                urlFriendlyTitle = urlFriendlyTitle.Substring(0, maxLength);
            }

            // Remove hífen no final, se existir
            return urlFriendlyTitle.TrimEnd('-');
        }

    }
}
