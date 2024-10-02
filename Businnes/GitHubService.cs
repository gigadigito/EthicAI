using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading.Tasks;
using System.Collections.Generic;

public class GitHubService
{
    private readonly HttpClient _httpClient;

    public GitHubService(HttpClient httpClient)
    {
        _httpClient = httpClient;
        // Define o user-agent para evitar erros na requisição
        _httpClient.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (compatible; BlazorApp/1.0)");
    }

    public async Task<List<GitHubCommit>> GetCommitsAsync(string owner, string repo, string token)
    {
        // Adiciona o token ao cabeçalho da requisição
        _httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        // Faz a requisição para buscar os commits do repositório
        var requestUri = $"https://api.github.com/repos/{owner}/{repo}/commits";
        var response = await _httpClient.GetAsync(requestUri);

        if (response.IsSuccessStatusCode)
        {
            var content = await response.Content.ReadAsStringAsync();
            var options = new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true, // Ignora diferença entre maiúsculas e minúsculas nas propriedades
            };
            var commits = JsonSerializer.Deserialize<List<GitHubCommit>>(content, options);
            return commits;
        }

        return null;
    }
}

// Definindo os modelos para serializar/deserializar os dados da API do GitHub
public class GitHubCommit
{
    public string Sha { get; set; }
    public CommitInfo Commit { get; set; }
    public GitHubUser Author { get; set; }
    public GitHubUser Committer { get; set; }
    public string Html_Url { get; set; }
    public string Url { get; set; }
}

public class CommitInfo
{
    public CommitAuthor Author { get; set; }
    public CommitAuthor Committer { get; set; }
    public string Message { get; set; }
    public CommitTree Tree { get; set; }
    public string Url { get; set; }
    public int Comment_Count { get; set; }
    public Verification Verification { get; set; }
}

public class CommitAuthor
{
    public string Name { get; set; }
    public string Email { get; set; }
    public DateTime Date { get; set; }
}

public class CommitTree
{
    public string Sha { get; set; }
    public string Url { get; set; }
}

public class Verification
{
    public bool Verified { get; set; }
    public string Reason { get; set; }
    public string Signature { get; set; }
    public string Payload { get; set; }
}

public class GitHubUser
{
    public string Login { get; set; }
    public int Id { get; set; }
    public string Node_Id { get; set; }
    public string Avatar_Url { get; set; }
    public string Url { get; set; }
    public string Html_Url { get; set; }
    public string Followers_Url { get; set; }
    public string Following_Url { get; set; }
    public string Gists_Url { get; set; }
    public string Starred_Url { get; set; }
    public string Subscriptions_Url { get; set; }
    public string Organizations_Url { get; set; }
    public string Repos_Url { get; set; }
    public string Events_Url { get; set; }
    public string Received_Events_Url { get; set; }
    public string Type { get; set; }
    public bool Site_Admin { get; set; }
}