using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DAL.Migrations
{
    public partial class AddCoinSocialProfileVisualFields : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "in_meme_coin",
                table: "coin_social_profile",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "nr_market_cap_rank",
                table: "coin_social_profile",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tx_large_image_url",
                table: "coin_social_profile",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tx_name",
                table: "coin_social_profile",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tx_primary_color",
                table: "coin_social_profile",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tx_secondary_color",
                table: "coin_social_profile",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tx_thumb_url",
                table: "coin_social_profile",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tx_visual_style",
                table: "coin_social_profile",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "in_meme_coin",
                table: "coin_social_profile");

            migrationBuilder.DropColumn(
                name: "nr_market_cap_rank",
                table: "coin_social_profile");

            migrationBuilder.DropColumn(
                name: "tx_large_image_url",
                table: "coin_social_profile");

            migrationBuilder.DropColumn(
                name: "tx_name",
                table: "coin_social_profile");

            migrationBuilder.DropColumn(
                name: "tx_primary_color",
                table: "coin_social_profile");

            migrationBuilder.DropColumn(
                name: "tx_secondary_color",
                table: "coin_social_profile");

            migrationBuilder.DropColumn(
                name: "tx_thumb_url",
                table: "coin_social_profile");

            migrationBuilder.DropColumn(
                name: "tx_visual_style",
                table: "coin_social_profile");
        }
    }
}
