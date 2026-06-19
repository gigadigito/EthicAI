using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DAL.Migrations
{
    public partial class ExpandCurrencyPercentageChangePrecision : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE currency
                    ALTER COLUMN nr_percentage_change TYPE numeric(12,4)
                    USING round(nr_percentage_change::numeric, 4);
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE currency
                    ALTER COLUMN nr_percentage_change TYPE numeric(5,2)
                    USING round(nr_percentage_change::numeric, 2);
                """);
        }
    }
}
