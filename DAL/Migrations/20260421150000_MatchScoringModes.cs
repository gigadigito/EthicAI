using System;
using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DAL.Migrations
{
    [DbContext(typeof(EthicAIDbContext))]
    [Migration("20260421150000_MatchScoringModes")]
    public partial class MatchScoringModes : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "in_scoring_rule",
                table: "match",
                type: "character varying(40)",
                maxLength: 40,
                nullable: false,
                defaultValue: MatchScoringRuleType.PercentThreshold.ToString());

            migrationBuilder.AddColumn<decimal>(
                name: "nr_quote_volume",
                table: "currency",
                type: "decimal(28,8)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<long>(
                name: "nr_trades_count",
                table: "currency",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.CreateTable(
                name: "match_score_state",
                columns: table => new
                {
                    cd_match = table.Column<int>(type: "integer", nullable: false),
                    nr_thresholds_awarded_a = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    nr_thresholds_awarded_b = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    cd_last_percentage_leader = table.Column<int>(type: "integer", nullable: true),
                    cd_last_volume_leader = table.Column<int>(type: "integer", nullable: true),
                    dt_last_volume_window_start = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    dt_last_volume_window_end = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    nr_last_event_sequence = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    dt_last_snapshot_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    dt_created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    dt_updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_match_score_state", x => x.cd_match);
                    table.ForeignKey(
                        name: "FK_match_score_state_match_cd_match",
                        column: x => x.cd_match,
                        principalTable: "match",
                        principalColumn: "cd_match",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "match_metric_snapshot",
                columns: table => new
                {
                    cd_match_metric_snapshot = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    cd_match = table.Column<int>(type: "integer", nullable: false),
                    cd_team = table.Column<int>(type: "integer", nullable: false),
                    dt_captured_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    nr_percentage_change = table.Column<decimal>(type: "decimal(18,8)", nullable: false),
                    nr_quote_volume = table.Column<decimal>(type: "decimal(28,8)", nullable: false),
                    nr_trade_count = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_match_metric_snapshot", x => x.cd_match_metric_snapshot);
                    table.ForeignKey(
                        name: "FK_match_metric_snapshot_match_cd_match",
                        column: x => x.cd_match,
                        principalTable: "match",
                        principalColumn: "cd_match",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_match_metric_snapshot_team_cd_team",
                        column: x => x.cd_team,
                        principalTable: "team",
                        principalColumn: "cd_team",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "match_score_event",
                columns: table => new
                {
                    cd_match_score_event = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    cd_match = table.Column<int>(type: "integer", nullable: false),
                    cd_team = table.Column<int>(type: "integer", nullable: false),
                    in_rule_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    tx_event_type = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    tx_reason_code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    nr_points = table.Column<int>(type: "integer", nullable: false),
                    nr_event_sequence = table.Column<int>(type: "integer", nullable: false),
                    nr_team_percentage_change = table.Column<decimal>(type: "decimal(18,8)", nullable: true),
                    nr_opponent_percentage_change = table.Column<decimal>(type: "decimal(18,8)", nullable: true),
                    nr_team_quote_volume = table.Column<decimal>(type: "decimal(28,8)", nullable: true),
                    nr_opponent_quote_volume = table.Column<decimal>(type: "decimal(28,8)", nullable: true),
                    nr_metric_delta = table.Column<decimal>(type: "decimal(28,8)", nullable: true),
                    dt_window_start = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    dt_window_end = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    tx_description = table.Column<string>(type: "text", nullable: false),
                    dt_event_time = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_match_score_event", x => x.cd_match_score_event);
                    table.ForeignKey(
                        name: "FK_match_score_event_match_cd_match",
                        column: x => x.cd_match,
                        principalTable: "match",
                        principalColumn: "cd_match",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_match_score_event_team_cd_team",
                        column: x => x.cd_team,
                        principalTable: "team",
                        principalColumn: "cd_team",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_match_metric_snapshot_cd_match_cd_team_dt_captured_at",
                table: "match_metric_snapshot",
                columns: new[] { "cd_match", "cd_team", "dt_captured_at" });

            migrationBuilder.CreateIndex(
                name: "IX_match_metric_snapshot_cd_team",
                table: "match_metric_snapshot",
                column: "cd_team");

            migrationBuilder.CreateIndex(
                name: "IX_match_score_event_cd_match_nr_event_sequence",
                table: "match_score_event",
                columns: new[] { "cd_match", "nr_event_sequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_match_score_event_cd_team",
                table: "match_score_event",
                column: "cd_team");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "match_metric_snapshot");

            migrationBuilder.DropTable(
                name: "match_score_event");

            migrationBuilder.DropTable(
                name: "match_score_state");

            migrationBuilder.DropColumn(
                name: "in_scoring_rule",
                table: "match");

            migrationBuilder.DropColumn(
                name: "nr_quote_volume",
                table: "currency");

            migrationBuilder.DropColumn(
                name: "nr_trades_count",
                table: "currency");
        }
    }
}
