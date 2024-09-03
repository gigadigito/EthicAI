﻿// <auto-generated />
using System;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using NFT_JOGO.EntityModel;

#nullable disable

namespace NFT_JOGO.Migrations
{
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20240118183043_NFTDb")]
    partial class NFTDb
    {
        /// <inheritdoc />
        protected override void BuildTargetModel(ModelBuilder modelBuilder)
        {
#pragma warning disable 612, 618
            modelBuilder
                .HasAnnotation("ProductVersion", "7.0.9")
                .HasAnnotation("Relational:MaxIdentifierLength", 128);

            SqlServerModelBuilderExtensions.UseIdentityColumns(modelBuilder);

            modelBuilder.Entity("NFT_JOGO.EntityModel.Usuario", b =>
                {
                    b.Property<int>("UsuarioID")
                        .ValueGeneratedOnAdd()
                        .HasColumnType("int")
                        .HasColumnName("cd_usuario");

                    SqlServerPropertyBuilderExtensions.UseIdentityColumn(b.Property<int>("UsuarioID"));

                    b.Property<string>("CarteiraEndereco")
                        .IsRequired()
                        .HasMaxLength(50)
                        .HasColumnType("nvarchar(50)")
                        .HasColumnName("tx_carterira_endereco");

                    b.Property<DateTime>("DataAtualizacao")
                        .HasColumnType("datetime")
                        .HasColumnName("dt_atualizacao");

                    b.Property<string>("NomeJogador")
                        .IsRequired()
                        .HasMaxLength(50)
                        .HasColumnType("nvarchar(50)")
                        .HasColumnName("nm_jogador");

                    b.HasKey("UsuarioID");

                    b.ToTable("usuario", (string)null);
                });
#pragma warning restore 612, 618
        }
    }
}
