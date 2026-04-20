using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DAL.Migrations
{
    [DbContext(typeof(EthicAIDbContext))]
    [Migration("20260420183000_UserTeamPositionOnChainFields")]
    public partial class UserTeamPositionOnChainFields : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "tx_onchain_position",
                table: "user_team_position",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tx_onchain_vault",
                table: "user_team_position",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tx_last_onchain_signature",
                table: "user_team_position",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tx_onchain_cluster",
                table: "user_team_position",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "nr_current_lamports",
                table: "user_team_position",
                type: "bigint",
                nullable: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "tx_onchain_position",
                table: "user_team_position");

            migrationBuilder.DropColumn(
                name: "tx_onchain_vault",
                table: "user_team_position");

            migrationBuilder.DropColumn(
                name: "tx_last_onchain_signature",
                table: "user_team_position");

            migrationBuilder.DropColumn(
                name: "tx_onchain_cluster",
                table: "user_team_position");

            migrationBuilder.DropColumn(
                name: "nr_current_lamports",
                table: "user_team_position");
        }
    }
}
