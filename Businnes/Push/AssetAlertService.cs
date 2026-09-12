using DAL.NftFutebol;

namespace BLL.Push;

public interface IAssetAlertService
{
    string BuildEventKey(long assetAlertSubscriptionId, int currencyId, int matchId);
}

public sealed class AssetAlertService : IAssetAlertService
{
    public string BuildEventKey(long assetAlertSubscriptionId, int currencyId, int matchId)
        => $"asset-playing:{assetAlertSubscriptionId}:{currencyId}:{matchId}";
}
