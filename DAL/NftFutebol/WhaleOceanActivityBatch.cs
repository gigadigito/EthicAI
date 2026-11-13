namespace DAL.NftFutebol;

/// <summary>
/// One deduplicated, already-aggregated market-flow window for Whale Ocean.
/// It stores counts, not rendered entities, positions, frames, or animation data.
/// </summary>
public sealed class WhaleOceanActivityBatch
{
    public long WhaleOceanActivityBatchId { get; set; }
    public int MatchId { get; set; }
    public string SourceId { get; set; } = string.Empty;
    public string Symbol { get; set; } = string.Empty;
    public long Sequence { get; set; }
    public DateTimeOffset WindowStartUtc { get; set; }
    public DateTimeOffset EventTimeUtc { get; set; }
    public DateTimeOffset ReceivedAtUtc { get; set; }
    public bool IsPartial { get; set; }
    public long TradeCount { get; set; }
    public long SmallBuy { get; set; }
    public long MediumBuy { get; set; }
    public long LargeBuy { get; set; }
    public long SharkBuy { get; set; }
    public long WhaleBuy { get; set; }
    public long SmallSell { get; set; }
    public long MediumSell { get; set; }
    public long LargeSell { get; set; }
    public long SharkSell { get; set; }
    public long WhaleSell { get; set; }
}
