using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DAL.Migrations
{
    public partial class AddMatchMetricHourlyAggregateRetention : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "match_metric_hourly_aggregate",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    cd_match = table.Column<int>(type: "integer", nullable: false),
                    cd_team = table.Column<int>(type: "integer", nullable: false),
                    tx_symbol = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    dt_hour_bucket = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    nr_avg_percentage_change = table.Column<decimal>(type: "numeric(18,8)", nullable: false),
                    nr_min_percentage_change = table.Column<decimal>(type: "numeric(18,8)", nullable: false),
                    nr_max_percentage_change = table.Column<decimal>(type: "numeric(18,8)", nullable: false),
                    nr_avg_quote_volume = table.Column<decimal>(type: "numeric(28,8)", nullable: false),
                    nr_min_quote_volume = table.Column<decimal>(type: "numeric(28,8)", nullable: false),
                    nr_max_quote_volume = table.Column<decimal>(type: "numeric(28,8)", nullable: false),
                    nr_avg_trade_count = table.Column<decimal>(type: "numeric(20,4)", nullable: false),
                    nr_min_trade_count = table.Column<long>(type: "bigint", nullable: false),
                    nr_max_trade_count = table.Column<long>(type: "bigint", nullable: false),
                    nr_snapshot_count = table.Column<int>(type: "integer", nullable: false),
                    dt_created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    dt_updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_match_metric_hourly_aggregate", x => x.id);
                    table.ForeignKey(
                        name: "FK_match_metric_hourly_aggregate_match_cd_match",
                        column: x => x.cd_match,
                        principalTable: "match",
                        principalColumn: "cd_match",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_match_metric_hourly_aggregate_team_cd_team",
                        column: x => x.cd_team,
                        principalTable: "team",
                        principalColumn: "cd_team",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_arena_sentiment_snapshot_calculated_at",
                table: "arena_sentiment_snapshot",
                column: "calculated_at");

            migrationBuilder.CreateIndex(
                name: "IX_match_metric_hourly_aggregate_cd_match_cd_team_tx_symbol_dt_hour_bucket",
                table: "match_metric_hourly_aggregate",
                columns: new[] { "cd_match", "cd_team", "tx_symbol", "dt_hour_bucket" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_match_metric_hourly_aggregate_cd_match_dt_hour_bucket",
                table: "match_metric_hourly_aggregate",
                columns: new[] { "cd_match", "dt_hour_bucket" });

            migrationBuilder.CreateIndex(
                name: "IX_match_metric_hourly_aggregate_cd_team",
                table: "match_metric_hourly_aggregate",
                column: "cd_team");

            migrationBuilder.CreateIndex(
                name: "IX_match_metric_hourly_aggregate_tx_symbol_dt_hour_bucket",
                table: "match_metric_hourly_aggregate",
                columns: new[] { "tx_symbol", "dt_hour_bucket" });

            migrationBuilder.CreateIndex(
                name: "IX_match_metric_snapshot_dt_captured_at",
                table: "match_metric_snapshot",
                column: "dt_captured_at");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_arena_sentiment_snapshot_calculated_at",
                table: "arena_sentiment_snapshot");

            migrationBuilder.DropIndex(
                name: "IX_match_metric_snapshot_dt_captured_at",
                table: "match_metric_snapshot");

            migrationBuilder.DropTable(
                name: "match_metric_hourly_aggregate");
        }
    }
}
