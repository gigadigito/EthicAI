using Npgsql;

var connString = "Host=localhost;Port=15432;Database=appdb;Username=appuser;Password=Macross@x1";
var wallet = "2ahAKQUE3xTHnVTb3cNESq8mjtqBDC59BnKvt3QVi6cG";

const string sql = """
select
    u.cd_user,
    u.tx_wallet,
    u.nr_balance as system_balance,
    u.nr_total_claimed,
    u.nr_total_withdrawn,
    coalesce(sum(b.nr_amount),0) as total_bet_amount,
    coalesce(sum(case when b.dt_settled_at is null then b.nr_amount else 0 end),0) as unsettled_bet_amount,
    coalesce(sum(case when b.dt_settled_at is not null and not b.is_claimed then coalesce(b.nr_payout_amount,0) else 0 end),0) as unclaimed_payout_amount,
    coalesce(sum(case when b.dt_settled_at is not null then coalesce(b.nr_payout_amount,0) else 0 end),0) as settled_payout_amount,
    count(b.cd_bet) as bet_count,
    coalesce((select count(*) from user_team_position p where p.cd_user = u.cd_user and p.in_status <> 2),0) as open_position_rows,
    coalesce((select sum(p.nr_principal_allocated) from user_team_position p where p.cd_user = u.cd_user and p.in_status <> 2),0) as open_positions_principal,
    coalesce((select sum(p.nr_current_capital) from user_team_position p where p.cd_user = u.cd_user and p.in_status <> 2),0) as open_positions_current_capital
from "user" u
left join bet b on b.cd_user = u.cd_user
where u.tx_wallet = @wallet
group by u.cd_user, u.tx_wallet, u.nr_balance, u.nr_total_claimed, u.nr_total_withdrawn;
""";

await using var conn = new NpgsqlConnection(connString);
await conn.OpenAsync();

await using var cmd = new NpgsqlCommand(sql, conn);
cmd.Parameters.AddWithValue("wallet", wallet);

await using var reader = await cmd.ExecuteReaderAsync();

if (!await reader.ReadAsync())
{
    Console.WriteLine("Wallet not found.");
    return;
}

for (var i = 0; i < reader.FieldCount; i++)
{
    Console.WriteLine($"{reader.GetName(i)}: {reader.GetValue(i)}");
}
