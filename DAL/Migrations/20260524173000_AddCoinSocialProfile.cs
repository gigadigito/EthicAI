using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DAL.Migrations
{
    public partial class AddCoinSocialProfile : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "coin_social_profile",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    symbol = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    coingecko_id = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    contract_address = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    twitter_handle = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    telegram_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    website_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    source = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    last_checked_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_coin_social_profile", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_coin_social_profile_symbol",
                table: "coin_social_profile",
                column: "symbol",
                unique: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "coin_social_profile");
        }
    }
}
