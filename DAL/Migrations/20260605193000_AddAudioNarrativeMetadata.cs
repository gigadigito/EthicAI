using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DAL.Migrations
{
    public partial class AddAudioNarrativeMetadata : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "raw_symbol",
                table: "audio_generation_queue",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "normalized_symbol",
                table: "audio_generation_queue",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "team_name",
                table: "audio_generation_queue",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "raw_symbol",
                table: "audio_asset",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "normalized_symbol",
                table: "audio_asset",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "team_name",
                table: "audio_asset",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE audio_generation_queue
                SET normalized_symbol = COALESCE(normalized_symbol, team_symbol),
                    team_name = COALESCE(team_name, team_symbol)
                WHERE normalized_symbol IS NULL OR team_name IS NULL;
                """);

            migrationBuilder.Sql("""
                UPDATE audio_asset
                SET normalized_symbol = COALESCE(normalized_symbol, team_symbol),
                    team_name = COALESCE(team_name, team_symbol)
                WHERE normalized_symbol IS NULL OR team_name IS NULL;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_audio_asset_event_type_language_normalized_symbol_context_key_intensity_status",
                table: "audio_asset",
                columns: new[] { "event_type", "language", "normalized_symbol", "context_key", "intensity", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_audio_generation_queue_event_type_language_normalized_symbol_c_5737",
                table: "audio_generation_queue",
                columns: new[] { "event_type", "language", "normalized_symbol", "context_key", "intensity" });
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_audio_asset_event_type_language_normalized_symbol_context_key_intensity_status",
                table: "audio_asset");

            migrationBuilder.DropIndex(
                name: "IX_audio_generation_queue_event_type_language_normalized_symbol_c_5737",
                table: "audio_generation_queue");

            migrationBuilder.DropColumn(
                name: "raw_symbol",
                table: "audio_generation_queue");

            migrationBuilder.DropColumn(
                name: "normalized_symbol",
                table: "audio_generation_queue");

            migrationBuilder.DropColumn(
                name: "team_name",
                table: "audio_generation_queue");

            migrationBuilder.DropColumn(
                name: "raw_symbol",
                table: "audio_asset");

            migrationBuilder.DropColumn(
                name: "normalized_symbol",
                table: "audio_asset");

            migrationBuilder.DropColumn(
                name: "team_name",
                table: "audio_asset");
        }
    }
}
