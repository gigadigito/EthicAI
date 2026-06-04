using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DAL.Migrations
{
    public partial class AddProceduralAudioInfrastructure : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "audio_asset",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    event_type = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    language = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    team_symbol = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    context_key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    intensity = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    voice_key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    template_key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    text_prompt = table.Column<string>(type: "text", nullable: true),
                    audio_url = table.Column<string>(type: "text", nullable: false),
                    relative_path = table.Column<string>(type: "text", nullable: false),
                    file_name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    mime_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false, defaultValue: "audio/mpeg"),
                    duration_ms = table.Column<int>(type: "integer", nullable: true),
                    file_size_bytes = table.Column<long>(type: "bigint", nullable: true),
                    file_hash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    generation_model = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    generation_source = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    quality_score = table.Column<decimal>(type: "numeric(5,2)", nullable: true),
                    priority = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    usage_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false, defaultValue: "ready"),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    last_used_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audio_asset", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "audio_phrase_template",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    template_key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    event_type = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    language = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    context_key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    intensity = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    template_text = table.Column<string>(type: "text", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    priority = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audio_phrase_template", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "audio_voice_profile",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    voice_key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    language = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    display_name = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    sample_relative_path = table.Column<string>(type: "text", nullable: false),
                    sample_url = table.Column<string>(type: "text", nullable: false),
                    provider = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    voice_style = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    priority = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audio_voice_profile", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "audio_generation_queue",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    event_type = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    language = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    team_symbol = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    context_key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    intensity = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    voice_key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    template_key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    text_prompt = table.Column<string>(type: "text", nullable: false),
                    target_relative_path = table.Column<string>(type: "text", nullable: true),
                    target_file_name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false, defaultValue: "pending"),
                    priority = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    attempt_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    max_attempts = table.Column<int>(type: "integer", nullable: false, defaultValue: 3),
                    lease_owner = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    leased_until_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    error_message = table.Column<string>(type: "text", nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    processed_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    completed_audio_asset_id = table.Column<long>(type: "bigint", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audio_generation_queue", x => x.id);
                    table.ForeignKey(
                        name: "FK_audio_generation_queue_audio_asset_completed_audio_asset_id",
                        column: x => x.completed_audio_asset_id,
                        principalTable: "audio_asset",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.AddColumn<string>(
                name: "tx_audio_context_key",
                table: "match_score_event",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tx_audio_intensity",
                table: "match_score_event",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tx_audio_voice_key",
                table: "match_score_event",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "audio_asset_id",
                table: "match_score_event",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tx_audio_url",
                table: "match_score_event",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "fl_audio_fallback_used",
                table: "match_score_event",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "tx_audio_resolved_language",
                table: "match_score_event",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_audio_asset_event_type_language_status",
                table: "audio_asset",
                columns: new[] { "event_type", "language", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_audio_asset_event_type_language_team_symbol",
                table: "audio_asset",
                columns: new[] { "event_type", "language", "team_symbol" });

            migrationBuilder.CreateIndex(
                name: "IX_audio_asset_event_type_language_team_symbol_context_key_int~",
                table: "audio_asset",
                columns: new[] { "event_type", "language", "team_symbol", "context_key", "intensity", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_audio_asset_file_hash",
                table: "audio_asset",
                column: "file_hash",
                unique: true,
                filter: "\"file_hash\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_audio_generation_queue_completed_audio_asset_id",
                table: "audio_generation_queue",
                column: "completed_audio_asset_id");

            migrationBuilder.CreateIndex(
                name: "IX_audio_generation_queue_event_type_language_team_symbol_cont~",
                table: "audio_generation_queue",
                columns: new[] { "event_type", "language", "team_symbol", "context_key", "intensity" });

            migrationBuilder.CreateIndex(
                name: "IX_audio_generation_queue_leased_until_utc",
                table: "audio_generation_queue",
                column: "leased_until_utc");

            migrationBuilder.CreateIndex(
                name: "IX_audio_generation_queue_status_priority_created_at_utc",
                table: "audio_generation_queue",
                columns: new[] { "status", "priority", "created_at_utc" });

            migrationBuilder.CreateIndex(
                name: "IX_audio_phrase_template_template_key",
                table: "audio_phrase_template",
                column: "template_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_audio_voice_profile_voice_key",
                table: "audio_voice_profile",
                column: "voice_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_match_score_event_audio_asset_id",
                table: "match_score_event",
                column: "audio_asset_id");

            migrationBuilder.AddForeignKey(
                name: "FK_match_score_event_audio_asset_audio_asset_id",
                table: "match_score_event",
                column: "audio_asset_id",
                principalTable: "audio_asset",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_match_score_event_audio_asset_audio_asset_id",
                table: "match_score_event");

            migrationBuilder.DropTable(
                name: "audio_generation_queue");

            migrationBuilder.DropTable(
                name: "audio_phrase_template");

            migrationBuilder.DropTable(
                name: "audio_voice_profile");

            migrationBuilder.DropTable(
                name: "audio_asset");

            migrationBuilder.DropIndex(
                name: "IX_match_score_event_audio_asset_id",
                table: "match_score_event");

            migrationBuilder.DropColumn(
                name: "tx_audio_context_key",
                table: "match_score_event");

            migrationBuilder.DropColumn(
                name: "tx_audio_intensity",
                table: "match_score_event");

            migrationBuilder.DropColumn(
                name: "tx_audio_voice_key",
                table: "match_score_event");

            migrationBuilder.DropColumn(
                name: "audio_asset_id",
                table: "match_score_event");

            migrationBuilder.DropColumn(
                name: "tx_audio_url",
                table: "match_score_event");

            migrationBuilder.DropColumn(
                name: "fl_audio_fallback_used",
                table: "match_score_event");

            migrationBuilder.DropColumn(
                name: "tx_audio_resolved_language",
                table: "match_score_event");
        }
    }
}
