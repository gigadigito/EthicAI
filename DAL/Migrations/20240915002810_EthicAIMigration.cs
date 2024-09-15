using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DAL.Migrations
{
    /// <inheritdoc />
    public partial class EthicAIMigration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
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
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "user");
        }
    }
}
