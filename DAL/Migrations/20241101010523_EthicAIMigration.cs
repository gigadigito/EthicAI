using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace DAL.Migrations
{
    /// <inheritdoc />
    public partial class EthicAIMigration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "post_category",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false),
                    tx_name = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_post_category", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "user",
                columns: table => new
                {
                    cd_user = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    tx_wallet = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    nm_name = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    tx_email = table.Column<string>(type: "nvarchar(254)", maxLength: 254, nullable: true),
                    dt_update = table.Column<DateTime>(type: "datetime", nullable: false),
                    is_human = table.Column<bool>(type: "bit", nullable: true),
                    tx_human_captcha = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    dt_human_validation = table.Column<DateTime>(type: "datetime", nullable: true),
                    dt_create = table.Column<DateTime>(type: "datetime2", nullable: false),
                    dt_last_login = table.Column<DateTime>(type: "datetime", nullable: true),
                    nm_ia = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    nm_human_representative = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    nm_company = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    nm_ia_model = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user", x => x.cd_user);
                });

            migrationBuilder.CreateTable(
                name: "post",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    tx_title = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    tx_url = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    tx_content = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    dt_post = table.Column<DateTime>(type: "datetime", nullable: false),
                    aq_image = table.Column<byte[]>(type: "varbinary(max)", nullable: false),
                    post_category_id = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_post", x => x.Id);
                    table.ForeignKey(
                        name: "FK_post_post_category_post_category_id",
                        column: x => x.post_category_id,
                        principalTable: "post_category",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pre_sale_purchase",
                columns: table => new
                {
                    id_purchase = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    user_id = table.Column<int>(type: "int", nullable: false),
                    sol_amount = table.Column<decimal>(type: "decimal(18,8)", nullable: false),
                    ethic_ai_amount = table.Column<decimal>(type: "decimal(18,8)", nullable: false),
                    purchase_date = table.Column<DateTime>(type: "datetime", nullable: false),
                    transaction_hash = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pre_sale_purchase", x => x.id_purchase);
                    table.ForeignKey(
                        name: "FK_pre_sale_purchase_user_user_id",
                        column: x => x.user_id,
                        principalTable: "user",
                        principalColumn: "cd_user",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "post_category",
                columns: new[] { "Id", "tx_name" },
                values: new object[,]
                {
                    { 1, "Technology" },
                    { 2, "Science" },
                    { 3, "Health" },
                    { 4, "Education" },
                    { 5, "Business" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_post_post_category_id",
                table: "post",
                column: "post_category_id");

            migrationBuilder.CreateIndex(
                name: "IX_pre_sale_purchase_user_id",
                table: "pre_sale_purchase",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "post");

            migrationBuilder.DropTable(
                name: "pre_sale_purchase");

            migrationBuilder.DropTable(
                name: "post_category");

            migrationBuilder.DropTable(
                name: "user");
        }
    }
}
