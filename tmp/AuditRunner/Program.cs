using System.Globalization;
using Npgsql;

const string connString = "Host=localhost;Port=15432;Database=appdb;Username=appuser;Password=Macross@x1";

var sql = """
WITH match_ctx AS (
    SELECT
        m.cd_match,
        ca.tx_symbol AS team_a_symbol,
        cb.tx_symbol AS team_b_symbol,
        m.nr_score_a,
        m.nr_score_b,
        m.cd_winner_team,
        m.tx_end_reason_code,
        m.in_status
    FROM match m
    JOIN team ta ON ta.cd_team = m.cd_team_a
    JOIN currency ca ON ca.cd_currency = ta.cd_currency
    JOIN team tb ON tb.cd_team = m.cd_team_b
    JOIN currency cb ON cb.cd_currency = tb.cd_currency
    WHERE m.cd_match = 397
),
bet_debit AS (
    SELECT
        l.reference_id AS bet_id,
        SUM(l.nr_amount) AS ledger_debit_amount
    FROM ledger l
    WHERE l.tx_type IN ('BET', 'BET_ONCHAIN')
    GROUP BY l.reference_id
)
SELECT
    mc.cd_match AS match_id,
    b.cd_bet AS bet_id,
    u.tx_wallet AS wallet,
    b.nr_amount AS apostado,
    CONCAT(mc.team_a_symbol, ' ', mc.nr_score_a, ' x ', mc.nr_score_b, ' ', mc.team_b_symbol) AS placar_final,
    mc.tx_end_reason_code AS motivo,
    CASE
        WHEN mc.nr_score_a = mc.nr_score_b
          OR mc.cd_winner_team IS NULL
          OR mc.tx_end_reason_code = 'NO_WINNER'
        THEN b.nr_amount
        ELSE COALESCE(b.nr_payout_amount, 0)
    END AS valor_esperado,
    COALESCE(b.nr_payout_amount, 0) AS valor_real,
    COALESCE(b.nr_payout_amount, 0) -
    CASE
        WHEN mc.nr_score_a = mc.nr_score_b
          OR mc.cd_winner_team IS NULL
          OR mc.tx_end_reason_code = 'NO_WINNER'
        THEN b.nr_amount
        ELSE COALESCE(b.nr_payout_amount, 0)
    END AS diferenca,
    CASE
        WHEN COALESCE(b.nr_payout_amount, 0) <>
             CASE
                 WHEN mc.nr_score_a = mc.nr_score_b
                   OR mc.cd_winner_team IS NULL
                   OR mc.tx_end_reason_code = 'NO_WINNER'
                 THEN b.nr_amount
                 ELSE COALESCE(b.nr_payout_amount, 0)
             END
        THEN 'BUG'
        ELSE 'OK'
    END AS status_bug,
    b.is_winner,
    b.is_claimed,
    bd.ledger_debit_amount
FROM bet b
JOIN match_ctx mc ON mc.cd_match = b.cd_match
JOIN "user" u ON u.cd_user = b.cd_user
LEFT JOIN bet_debit bd ON bd.bet_id = b.cd_bet
WHERE b.cd_match = 397
ORDER BY b.dt_bet_time, b.cd_bet;
""";

await using var conn = new NpgsqlConnection(connString);
await conn.OpenAsync();

await using var cmd = new NpgsqlCommand(sql, conn);
await using var reader = await cmd.ExecuteReaderAsync();

var headers = new[]
{
    "match_id", "bet_id", "wallet", "apostado", "placar_final", "motivo",
    "valor_esperado", "valor_real", "diferenca", "status_bug", "is_winner",
    "is_claimed", "ledger_debit_amount"
};

Console.WriteLine(string.Join(" | ", headers));

while (await reader.ReadAsync())
{
    var values = new string[headers.Length];
    for (var i = 0; i < headers.Length; i++)
    {
        values[i] = reader.IsDBNull(i)
            ? "NULL"
            : Convert.ToString(reader.GetValue(i), CultureInfo.InvariantCulture) ?? "";
    }

    Console.WriteLine(string.Join(" | ", values));
}
