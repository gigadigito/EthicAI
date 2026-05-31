using System.Text.Json.Serialization;

namespace DTOs;

public sealed class CoinSocialProfileDto
{
    public long Id { get; set; }
    public string Symbol { get; set; } = string.Empty;
    public string? CoinGeckoId { get; set; }
    public string? ContractAddress { get; set; }
    public string? Name { get; set; }
    public string? ThumbUrl { get; set; }
    public string? LargeImageUrl { get; set; }
    public int? MarketCapRank { get; set; }
    public bool? IsMemeCoin { get; set; }
    public string? PrimaryColor { get; set; }
    public string? SecondaryColor { get; set; }
    public string? VisualStyle { get; set; }
    public string? TwitterHandle { get; set; }
    public string? TelegramUrl { get; set; }
    public string? WebsiteUrl { get; set; }
    public string? Source { get; set; }
    public DateTime? LastCheckedUtc { get; set; }
}

public sealed class UpsertCoinSocialProfileRequest
{
    private string? _symbol;
    private string? _coinGeckoId;
    private string? _contractAddress;
    private string? _name;
    private string? _thumbUrl;
    private string? _largeImageUrl;
    private int? _marketCapRank;
    private bool? _isMemeCoin;
    private string? _primaryColor;
    private string? _secondaryColor;
    private string? _visualStyle;
    private string? _twitterHandle;
    private string? _telegramUrl;
    private string? _websiteUrl;
    private string? _source;
    private DateTime? _lastCheckedUtc;

    public string? Symbol
    {
        get => _symbol;
        set
        {
            HasSymbol = true;
            _symbol = value;
        }
    }

    public string? CoinGeckoId
    {
        get => _coinGeckoId;
        set
        {
            HasCoinGeckoId = true;
            _coinGeckoId = value;
        }
    }

    public string? ContractAddress
    {
        get => _contractAddress;
        set
        {
            HasContractAddress = true;
            _contractAddress = value;
        }
    }

    public string? Name
    {
        get => _name;
        set
        {
            HasName = true;
            _name = value;
        }
    }

    public string? ThumbUrl
    {
        get => _thumbUrl;
        set
        {
            HasThumbUrl = true;
            _thumbUrl = value;
        }
    }

    public string? LargeImageUrl
    {
        get => _largeImageUrl;
        set
        {
            HasLargeImageUrl = true;
            _largeImageUrl = value;
        }
    }

    public int? MarketCapRank
    {
        get => _marketCapRank;
        set
        {
            HasMarketCapRank = true;
            _marketCapRank = value;
        }
    }

    public bool? IsMemeCoin
    {
        get => _isMemeCoin;
        set
        {
            HasIsMemeCoin = true;
            _isMemeCoin = value;
        }
    }

    public string? PrimaryColor
    {
        get => _primaryColor;
        set
        {
            HasPrimaryColor = true;
            _primaryColor = value;
        }
    }

    public string? SecondaryColor
    {
        get => _secondaryColor;
        set
        {
            HasSecondaryColor = true;
            _secondaryColor = value;
        }
    }

    public string? VisualStyle
    {
        get => _visualStyle;
        set
        {
            HasVisualStyle = true;
            _visualStyle = value;
        }
    }

    public string? TwitterHandle
    {
        get => _twitterHandle;
        set
        {
            HasTwitterHandle = true;
            _twitterHandle = value;
        }
    }

    public string? TelegramUrl
    {
        get => _telegramUrl;
        set
        {
            HasTelegramUrl = true;
            _telegramUrl = value;
        }
    }

    public string? WebsiteUrl
    {
        get => _websiteUrl;
        set
        {
            HasWebsiteUrl = true;
            _websiteUrl = value;
        }
    }

    public string? Source
    {
        get => _source;
        set
        {
            HasSource = true;
            _source = value;
        }
    }

    public DateTime? LastCheckedUtc
    {
        get => _lastCheckedUtc;
        set
        {
            HasLastCheckedUtc = true;
            _lastCheckedUtc = value;
        }
    }

    [JsonIgnore] public bool HasSymbol { get; private set; }
    [JsonIgnore] public bool HasCoinGeckoId { get; private set; }
    [JsonIgnore] public bool HasContractAddress { get; private set; }
    [JsonIgnore] public bool HasName { get; private set; }
    [JsonIgnore] public bool HasThumbUrl { get; private set; }
    [JsonIgnore] public bool HasLargeImageUrl { get; private set; }
    [JsonIgnore] public bool HasMarketCapRank { get; private set; }
    [JsonIgnore] public bool HasIsMemeCoin { get; private set; }
    [JsonIgnore] public bool HasPrimaryColor { get; private set; }
    [JsonIgnore] public bool HasSecondaryColor { get; private set; }
    [JsonIgnore] public bool HasVisualStyle { get; private set; }
    [JsonIgnore] public bool HasTwitterHandle { get; private set; }
    [JsonIgnore] public bool HasTelegramUrl { get; private set; }
    [JsonIgnore] public bool HasWebsiteUrl { get; private set; }
    [JsonIgnore] public bool HasSource { get; private set; }
    [JsonIgnore] public bool HasLastCheckedUtc { get; private set; }
}

public sealed class CoinSocialProfileUpsertResponse
{
    public bool Ok { get; set; }
    public CoinSocialProfileDto Profile { get; set; } = new();
}
