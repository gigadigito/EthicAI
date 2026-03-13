FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# copia tudo do repo (porque a solução tem vários projetos referenciados)
COPY . .

# publica o projeto correto (API)
RUN dotnet publish ./CriptoVersus.API/CriptoVersus.API.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app

COPY --from=build /app/publish .

# força o kestrel a ouvir na 8080
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "CriptoVersus.API.dll"]
