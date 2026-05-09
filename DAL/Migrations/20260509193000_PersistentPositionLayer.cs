using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DAL.Migrations
{
    [DbContext(typeof(EthicAIDbContext))]
    [Migration("20260509193000_PersistentPositionLayer")]
    public partial class PersistentPositionLayer : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "tx_blockchain_mode_snapshot",
                table: "user_team_position",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "in_exposure_mode",
                table: "user_team_position",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "nr_total_losses",
                table: "user_team_position",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<decimal>(
                name: "nr_total_pnl",
                table: "user_team_position",
                type: "decimal(18, 8)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<int>(
                name: "nr_total_wins",
                table: "user_team_position",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "position_allocation",
                columns: table => new
                {
                    id_position_allocation = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    cd_position = table.Column<int>(type: "integer", nullable: false),
                    cd_match = table.Column<int>(type: "integer", nullable: false),
                    cd_bet = table.Column<int>(type: "integer", nullable: true),
                    nr_allocated_amount = table.Column<decimal>(type: "decimal(18, 8)", nullable: false),
                    nr_result_amount = table.Column<decimal>(type: "decimal(18, 8)", nullable: true),
                    nr_pnl = table.Column<decimal>(type: "decimal(18, 8)", nullable: true),
                    in_status = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    dt_created = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    dt_settled = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_position_allocation", x => x.id_position_allocation);
                    table.ForeignKey(
                        name: "FK_position_allocation_bet_cd_bet",
                        column: x => x.cd_bet,
                        principalTable: "bet",
                        principalColumn: "cd_bet",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_position_allocation_match_cd_match",
                        column: x => x.cd_match,
                        principalTable: "match",
                        principalColumn: "cd_match",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_position_allocation_user_team_position_cd_position",
                        column: x => x.cd_position,
                        principalTable: "user_team_position",
                        principalColumn: "cd_position",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "position_lifecycle_event",
                columns: table => new
                {
                    id_position_lifecycle_event = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    cd_position = table.Column<int>(type: "integer", nullable: false),
                    cd_match = table.Column<int>(type: "integer", nullable: true),
                    cd_bet = table.Column<int>(type: "integer", nullable: true),
                    in_event_type = table.Column<int>(type: "integer", nullable: false),
                    nr_amount = table.Column<decimal>(type: "decimal(18, 8)", nullable: true),
                    nr_capital_before = table.Column<decimal>(type: "decimal(18, 8)", nullable: true),
                    nr_capital_after = table.Column<decimal>(type: "decimal(18, 8)", nullable: true),
                    nr_pnl = table.Column<decimal>(type: "decimal(18, 8)", nullable: true),
                    tx_notes = table.Column<string>(type: "text", nullable: true),
                    dt_created = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_position_lifecycle_event", x => x.id_position_lifecycle_event);
                    table.ForeignKey(
                        name: "FK_position_lifecycle_event_bet_cd_bet",
                        column: x => x.cd_bet,
                        principalTable: "bet",
                        principalColumn: "cd_bet",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_position_lifecycle_event_match_cd_match",
                        column: x => x.cd_match,
                        principalTable: "match",
                        principalColumn: "cd_match",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_position_lifecycle_event_user_team_position_cd_position",
                        column: x => x.cd_position,
                        principalTable: "user_team_position",
                        principalColumn: "cd_position",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_position_allocation_cd_bet",
                table: "position_allocation",
                column: "cd_bet",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_position_allocation_cd_match",
                table: "position_allocation",
                column: "cd_match");

            migrationBuilder.CreateIndex(
                name: "IX_position_allocation_cd_position_cd_match",
                table: "position_allocation",
                columns: new[] { "cd_position", "cd_match" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_position_lifecycle_event_cd_bet",
                table: "position_lifecycle_event",
                column: "cd_bet");

            migrationBuilder.CreateIndex(
                name: "IX_position_lifecycle_event_cd_match",
                table: "position_lifecycle_event",
                column: "cd_match");

            migrationBuilder.CreateIndex(
                name: "IX_position_lifecycle_event_cd_position_dt_created",
                table: "position_lifecycle_event",
                columns: new[] { "cd_position", "dt_created" });
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "position_allocation");

            migrationBuilder.DropTable(
                name: "position_lifecycle_event");

            migrationBuilder.DropColumn(
                name: "tx_blockchain_mode_snapshot",
                table: "user_team_position");

            migrationBuilder.DropColumn(
                name: "in_exposure_mode",
                table: "user_team_position");

            migrationBuilder.DropColumn(
                name: "nr_total_losses",
                table: "user_team_position");

            migrationBuilder.DropColumn(
                name: "nr_total_pnl",
                table: "user_team_position");

            migrationBuilder.DropColumn(
                name: "nr_total_wins",
                table: "user_team_position");
        }
    }
}
