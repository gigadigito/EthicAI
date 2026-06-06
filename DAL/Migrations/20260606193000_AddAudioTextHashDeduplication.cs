using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DAL.Migrations
{
    public partial class AddAudioTextHashDeduplication : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "normalized_text",
                table: "audio_generation_queue",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "text_hash",
                table: "audio_generation_queue",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "normalized_text",
                table: "audio_asset",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "text_hash",
                table: "audio_asset",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_audio_asset_text_hash_language_voice_key_status",
                table: "audio_asset",
                columns: new[] { "text_hash", "language", "voice_key", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_audio_generation_queue_text_hash_language_voice_key_status",
                table: "audio_generation_queue",
                columns: new[] { "text_hash", "language", "voice_key", "status" });
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_audio_asset_text_hash_language_voice_key_status",
                table: "audio_asset");

            migrationBuilder.DropIndex(
                name: "IX_audio_generation_queue_text_hash_language_voice_key_status",
                table: "audio_generation_queue");

            migrationBuilder.DropColumn(
                name: "normalized_text",
                table: "audio_generation_queue");

            migrationBuilder.DropColumn(
                name: "text_hash",
                table: "audio_generation_queue");

            migrationBuilder.DropColumn(
                name: "normalized_text",
                table: "audio_asset");

            migrationBuilder.DropColumn(
                name: "text_hash",
                table: "audio_asset");
        }
    }
}
