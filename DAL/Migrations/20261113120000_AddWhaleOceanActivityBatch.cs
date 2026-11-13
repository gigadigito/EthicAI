using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using EthicAI.EntityModel;

#nullable disable

namespace DAL.Migrations;

[DbContext(typeof(EthicAIDbContext))]
[Migration("20261113120000_AddWhaleOceanActivityBatch")]
public partial class AddWhaleOceanActivityBatch : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "whale_ocean_activity_batch",
            columns: table => new
            {
                cd_whale_ocean_activity_batch = table.Column<long>(type: "bigint", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                cd_match = table.Column<int>(type: "integer", nullable: false),
                tx_source_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                tx_symbol = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                nr_sequence = table.Column<long>(type: "bigint", nullable: false),
                dt_window_start = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                dt_event_time = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                dt_received_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                bl_partial = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                nr_trade_count = table.Column<long>(type: "bigint", nullable: false),
                nr_small_buy = table.Column<long>(type: "bigint", nullable: false),
                nr_medium_buy = table.Column<long>(type: "bigint", nullable: false),
                nr_large_buy = table.Column<long>(type: "bigint", nullable: false),
                nr_shark_buy = table.Column<long>(type: "bigint", nullable: false),
                nr_whale_buy = table.Column<long>(type: "bigint", nullable: false),
                nr_small_sell = table.Column<long>(type: "bigint", nullable: false),
                nr_medium_sell = table.Column<long>(type: "bigint", nullable: false),
                nr_large_sell = table.Column<long>(type: "bigint", nullable: false),
                nr_shark_sell = table.Column<long>(type: "bigint", nullable: false),
                nr_whale_sell = table.Column<long>(type: "bigint", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_whale_ocean_activity_batch", x => x.cd_whale_ocean_activity_batch);
                table.ForeignKey(
                    name: "FK_whale_ocean_activity_batch_match",
                    column: x => x.cd_match,
                    principalTable: "match",
                    principalColumn: "cd_match",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_whale_ocean_activity_batch_match_source_symbol_sequence",
            table: "whale_ocean_activity_batch",
            columns: new[] { "cd_match", "tx_source_id", "tx_symbol", "nr_sequence" },
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_whale_ocean_activity_batch_match_symbol_event_time",
            table: "whale_ocean_activity_batch",
            columns: new[] { "cd_match", "tx_symbol", "dt_event_time" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
        => migrationBuilder.DropTable(name: "whale_ocean_activity_batch");
}
