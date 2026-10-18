using System;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DAL.Migrations
{
    /// <summary>
    /// Controle de publicacao social sobre a tabela existente <c>social_post_history</c>.
    ///
    /// EXPAND-ONLY: apenas adiciona colunas anulaveis e indices. Nenhuma coluna existente e
    /// alterada ou removida, portanto as publicacoes atuais (incluindo Win Rate 24H) seguem
    /// funcionando sem alteracao. Registros legados permanecem com <c>category</c>,
    /// <c>status</c> e <c>idempotency_key</c> nulos.
    ///
    /// A coluna <c>post_text</c> permanece NOT NULL: a reserva usa <c>status</c>, nunca
    /// <c>post_text</c>, como mecanismo de controle.
    /// </summary>
    [DbContext(typeof(EthicAIDbContext))]
    [Migration("20261017000000_AddSocialPublicationControl")]
    public partial class AddSocialPublicationControl : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "category",
                table: "social_post_history",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "status",
                table: "social_post_history",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "idempotency_key",
                table: "social_post_history",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "reserved_at_utc",
                table: "social_post_history",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "lease_expires_at_utc",
                table: "social_post_history",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "posted_at_utc",
                table: "social_post_history",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "last_error",
                table: "social_post_history",
                type: "text",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_social_post_history_idempotency_key",
                table: "social_post_history",
                column: "idempotency_key",
                unique: true,
                filter: "idempotency_key IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_social_post_history_category_status_match_id",
                table: "social_post_history",
                columns: new[] { "category", "status", "match_id" });
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_social_post_history_category_status_match_id",
                table: "social_post_history");

            migrationBuilder.DropIndex(
                name: "IX_social_post_history_idempotency_key",
                table: "social_post_history");

            migrationBuilder.DropColumn(
                name: "category",
                table: "social_post_history");

            migrationBuilder.DropColumn(
                name: "status",
                table: "social_post_history");

            migrationBuilder.DropColumn(
                name: "idempotency_key",
                table: "social_post_history");

            migrationBuilder.DropColumn(
                name: "reserved_at_utc",
                table: "social_post_history");

            migrationBuilder.DropColumn(
                name: "lease_expires_at_utc",
                table: "social_post_history");

            migrationBuilder.DropColumn(
                name: "posted_at_utc",
                table: "social_post_history");

            migrationBuilder.DropColumn(
                name: "last_error",
                table: "social_post_history");
        }
    }
}
