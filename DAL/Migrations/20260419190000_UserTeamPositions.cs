using System;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DAL.Migrations
{
    [DbContext(typeof(EthicAIDbContext))]
    [Migration("20260419190000_UserTeamPositions")]
    public partial class UserTeamPositions : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "user_team_position",
                columns: table => new
                {
                    cd_position = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    cd_user = table.Column<int>(type: "integer", nullable: false),
                    cd_team = table.Column<int>(type: "integer", nullable: false),
                    nr_principal_allocated = table.Column<decimal>(type: "decimal(18, 8)", nullable: false),
                    nr_current_capital = table.Column<decimal>(type: "decimal(18, 8)", nullable: false),
                    is_auto_compound = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    in_status = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    dt_created = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    dt_updated = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    dt_closed = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_team_position", x => x.cd_position);
                    table.ForeignKey(
                        name: "FK_user_team_position_team_cd_team",
                        column: x => x.cd_team,
                        principalTable: "team",
                        principalColumn: "cd_team",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_user_team_position_user_cd_user",
                        column: x => x.cd_user,
                        principalTable: "user",
                        principalColumn: "cd_user",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddColumn<int>(
                name: "cd_position",
                table: "bet",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_user_team_position_cd_team",
                table: "user_team_position",
                column: "cd_team");

            migrationBuilder.CreateIndex(
                name: "IX_user_team_position_cd_user_cd_team",
                table: "user_team_position",
                columns: new[] { "cd_user", "cd_team" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_bet_cd_position",
                table: "bet",
                column: "cd_position");

            migrationBuilder.AddForeignKey(
                name: "FK_bet_user_team_position_cd_position",
                table: "bet",
                column: "cd_position",
                principalTable: "user_team_position",
                principalColumn: "cd_position",
                onDelete: ReferentialAction.SetNull);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_bet_user_team_position_cd_position",
                table: "bet");

            migrationBuilder.DropIndex(
                name: "IX_bet_cd_position",
                table: "bet");

            migrationBuilder.DropColumn(
                name: "cd_position",
                table: "bet");

            migrationBuilder.DropTable(
                name: "user_team_position");
        }
    }
}
