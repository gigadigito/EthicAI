using System;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DAL.Migrations
{
    [DbContext(typeof(EthicAIDbContext))]
    [Migration("20260514100000_AddArenaSentimentSnapshot")]
    public partial class AddArenaSentimentSnapshot : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "arena_sentiment_snapshot",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    symbol = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    score = table.Column<int>(type: "integer", nullable: false),
                    classification = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    price_momentum_score = table.Column<decimal>(type: "numeric(10,2)", nullable: true),
                    volume_score = table.Column<decimal>(type: "numeric(10,2)", nullable: true),
                    order_book_score = table.Column<decimal>(type: "numeric(10,2)", nullable: true),
                    funding_score = table.Column<decimal>(type: "numeric(10,2)", nullable: true),
                    long_short_score = table.Column<decimal>(type: "numeric(10,2)", nullable: true),
                    volatility_score = table.Column<decimal>(type: "numeric(10,2)", nullable: true),
                    data_coverage = table.Column<decimal>(type: "numeric(10,2)", nullable: false),
                    has_sufficient_data = table.Column<bool>(type: "boolean", nullable: false),
                    calculated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_arena_sentiment_snapshot", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_arena_sentiment_snapshot_symbol_calculated_at",
                table: "arena_sentiment_snapshot",
                columns: new[] { "symbol", "calculated_at" });
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "arena_sentiment_snapshot");
        }
    }
}
