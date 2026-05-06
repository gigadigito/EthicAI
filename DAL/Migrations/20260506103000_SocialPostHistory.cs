using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DAL.Migrations
{
    public partial class SocialPostHistory : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "social_post_history",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    match_id = table.Column<int>(type: "integer", nullable: false),
                    platform = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    post_text = table.Column<string>(type: "text", nullable: false),
                    post_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    external_post_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    hot_score = table.Column<int>(type: "integer", nullable: false),
                    reason = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_social_post_history", x => x.id);
                    table.ForeignKey(
                        name: "FK_social_post_history_match_match_id",
                        column: x => x.match_id,
                        principalTable: "match",
                        principalColumn: "cd_match",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_social_post_history_match_id_platform_created_at",
                table: "social_post_history",
                columns: new[] { "match_id", "platform", "created_at" });
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "social_post_history");
        }
    }
}
