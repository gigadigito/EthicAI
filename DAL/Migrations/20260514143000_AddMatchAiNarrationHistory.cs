using System;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DAL.Migrations
{
    [DbContext(typeof(EthicAIDbContext))]
    [Migration("20260514143000_AddMatchAiNarrationHistory")]
    public partial class AddMatchAiNarrationHistory : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "match_ai_narration_history",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    match_id = table.Column<int>(type: "integer", nullable: false),
                    event_type = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    culture = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    text = table.Column<string>(type: "text", nullable: false),
                    prompt_hash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    context_hash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    source = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    model = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    hot_score_snapshot = table.Column<int>(type: "integer", nullable: true),
                    left_score_snapshot = table.Column<int>(type: "integer", nullable: true),
                    right_score_snapshot = table.Column<int>(type: "integer", nullable: true),
                    leader_symbol_snapshot = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    metadata_json = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_match_ai_narration_history", x => x.id);
                    table.ForeignKey(
                        name: "FK_match_ai_narration_history_match_match_id",
                        column: x => x.match_id,
                        principalTable: "match",
                        principalColumn: "cd_match",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_match_ai_narration_history_match_id_created_at_utc",
                table: "match_ai_narration_history",
                columns: new[] { "match_id", "created_at_utc" });

            migrationBuilder.CreateIndex(
                name: "IX_match_ai_narration_history_match_id_event_type_context_hash",
                table: "match_ai_narration_history",
                columns: new[] { "match_id", "event_type", "context_hash" });
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "match_ai_narration_history");
        }
    }
}
