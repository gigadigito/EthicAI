# EF Core design-time migrations (VPS)

Operação segura do `dotnet ef` (`migrations list`, `migrations script`, `database update`) para o
schema `EthicAIDbContext`, sem executar alterações automáticas e sem expor credenciais.

Responsável pela conexão em design-time: `DAL/EthicAIDbContextFactory.cs` +
`DAL/MigrationConnectionResolver.cs`. O runtime (API/Worker) continua usando
`context.Database.Migrate()` na inicialização e não foi alterado.

## Resolução da conexão (design-time)

Prioridade:

1. Variável de ambiente `CRIPTOVERSUS_MIGRATION_CONNECTION` (uso operacional de migrations).
2. Variável de ambiente `ConnectionStrings__Default`.
3. `ConnectionStrings:Default` em `appsettings.json` do diretório atual,
   `../CriptoVersus.Worker/appsettings.json` ou `CriptoVersus.Worker/appsettings.json`.
4. Sem conexão configurada, a execução falha com exceção clara. Não existe fallback com
   credenciais fixas.

A conexão é validada com `NpgsqlConnectionStringBuilder` (obrigatórios: `Host`, `Database`,
`Username`). Apenas `Host`, `Database` e `Username` aparecem em mensagens e diagnósticos; a senha
nunca é registrada nem propagada em exceções.

Exemplo de formato (placeholders, nunca valores reais):

```text
Host=<host>;Port=5432;Database=<database>;Username=<username>;Password=<senha>
```

## Proteção contra `database update` acidental

- Alvo local (`localhost`, `127.0.0.1`, `::1` ou socket Unix): nenhuma confirmação adicional.
- Alvo não local (ex.: `Host=postgres` na rede Docker):
  - `dotnet ef migrations list` e `dotnet ef migrations script` são permitidos sem confirmação
    (a operação é identificada na linha de comando do processo).
  - `dotnet ef database update` e `dotnet ef database drop` exigem confirmação operacional
    explícita: `CRIPTOVERSUS_MIGRATION_ALLOW_UPDATE=true`.
  - Comandos não identificados também exigem a confirmação (política conservadora).

Observação: em túnel/loopback (`Host=127.0.0.1` apontando para produção) o alvo parece local e a
proteção não é acionada. Prefira sempre a execução via rede `root_internal` (Estratégia A), em que
o alvo `Host=postgres` permanece protegido.

## Rede

- PostgreSQL está na rede Docker `root_internal` e é resolvido como `postgres` apenas dentro de
  containers dessa rede. O hostname `postgres` não resolve no host Ubuntu.
- Não publique a porta 5432 na internet como solução.
- Estratégia A (recomendada): executar o EF CLI em um container SDK temporário conectado à
  `root_internal`.
- Estratégia B: executar no host com um endpoint PostgreSQL explicitamente autorizado (ex.:
  publicação apenas em `127.0.0.1` ou túnel SSH). Nesse caso use `Host=127.0.0.1;Port=<porta>` e
  observe a ressalva da proteção acima.

## Fornecer a conexão sem expor credenciais

- Nunca use `--connection` na linha de comando (vai para o histórico do shell e para `ps`).
- Carregue a conexão em variável de ambiente sem eco:

```bash
read -r -s -p "Conexão de migrations: " CRIPTOVERSUS_MIGRATION_CONNECTION
echo
export CRIPTOVERSUS_MIGRATION_CONNECTION
```

- Repasse ao container com `-e CRIPTOVERSUS_MIGRATION_CONNECTION` (valor lido do ambiente, não
  digitado no comando).
- Ao final: `unset CRIPTOVERSUS_MIGRATION_CONNECTION`.
- Não grave a conexão em arquivos, logs, `docker inspect` ou documentação.

## Comandos (VPS)

Estratégia A — container SDK na rede `root_internal`:

```bash
cd ~/stacks/criptoversus-api/src

read -r -s -p "Conexão de migrations: " CRIPTOVERSUS_MIGRATION_CONNECTION
echo
export CRIPTOVERSUS_MIGRATION_CONNECTION

docker run --rm -it \
  --network root_internal \
  -v "$PWD:/src" \
  -w /src \
  -e CRIPTOVERSUS_MIGRATION_CONNECTION \
  -v cv-nuget:/root/.nuget \
  mcr.microsoft.com/dotnet/sdk:8.0 \
  bash -lc 'dotnet tool install --global dotnet-ef --version 8.0.8 \
    && export PATH="$PATH:$HOME/.dotnet/tools" \
    && dotnet ef migrations list \
         --project DAL/DAL.csproj \
         --startup-project DAL/DAL.csproj \
         --context EthicAIDbContext \
         --msbuildprojectextensionspath /src/.codex-artifacts-local/obj/DAL \
         --no-connect'

unset CRIPTOVERSUS_MIGRATION_CONNECTION
```

Dica: monte o repositório leitura/escrita (`-v "$PWD:/src"` sem `:ro`), porque o build grava em
`.codex-artifacts-local`. O pacote NuGet do `dotnet-ef` deve ser `8.0.8` (mesma versão do EF Core).

No host (Estratégia B, quando há endpoint autorizado) o comando é o mesmo da seção de operação do
repositório, com `CRIPTOVERSUS_MIGRATION_CONNECTION` apontando para `Host=127.0.0.1;Port=<porta>`.

### 1) Listar migrations (não altera o banco)

```bash
dotnet ef migrations list \
  --project DAL/DAL.csproj \
  --startup-project DAL/DAL.csproj \
  --context EthicAIDbContext \
  --msbuildprojectextensionspath \
  "$PWD/.codex-artifacts-local/obj/DAL" \
  --no-connect
```

Com `--no-connect` não há conexão com o banco. Sem essa flag, a saída diferencia aplicadas de
pendentes. A última migration registrada em produção é
`20261015000000_AddCandleBattlesArcade`; a pendente é
`20261017000000_AddSocialPublicationControl` (expand-only: 7 colunas anuláveis + 2 índices em
`social_post_history`).

### 2) Gerar o SQL da migration sem aplicar (não altera o banco)

```bash
dotnet ef migrations script \
  20261015000000_AddCandleBattlesArcade \
  20261017000000_AddSocialPublicationControl \
  --project DAL/DAL.csproj \
  --startup-project DAL/DAL.csproj \
  --context EthicAIDbContext \
  --msbuildprojectextensionspath \
  "$PWD/.codex-artifacts-local/obj/DAL"
```

O SQL é escrito no `stdout`; o diagnóstico do design-time vai para `stderr`. Revise o script antes
de qualquer aplicação. Use `--idempotent` se for executá-lo com ferramentas que toleram
reexecução.

## Procedimento futuro: aplicar somente a migration desejada

Pré-requisitos: backup validado, `migrations list` conferido e SQL de `migrations script` revisado.

1. Backup (placeholder; ajuste ao seu processo padrão):

```bash
docker exec postgres pg_dump -U <username> -d <database> -Fc -f /tmp/appdb-$(date +%Y%m%d-%H%M).dump
```

2. Conferir pendências: `dotnet ef migrations list` (sem `--no-connect`) e confirmar que apenas
   `20261017000000_AddSocialPublicationControl` está pendente.

3. Revisar o SQL: `dotnet ef migrations script ...` conforme a seção 2.

4. Aplicar somente até a migration desejada (nome da migration = "até e incluindo"):

```bash
export CRIPTOVERSUS_MIGRATION_ALLOW_UPDATE=true
dotnet ef database update 20261017000000_AddSocialPublicationControl \
  --project DAL/DAL.csproj \
  --startup-project DAL/DAL.csproj \
  --context EthicAIDbContext \
  --msbuildprojectextensionspath \
  "$PWD/.codex-artifacts-local/obj/DAL"
unset CRIPTOVERSUS_MIGRATION_ALLOW_UPDATE
```

Sem argumento de destino, `database update` aplica TODAS as pendentes — sempre informe a
migration alvo. `CRIPTOVERSUS_MIGRATION_ALLOW_UPDATE=true` é a confirmação operacional exigida
para alvo não local.

Alternativa equivalente (aplica exatamente o SQL revisado): executar o script gerado via `psql` em
um container da rede `root_internal`. O script já inclui o registro em `__EFMigrationsHistory`.

5. Validar colunas/índices e o registro em `__EFMigrationsHistory` antes de retomar o fluxo normal
   de deploy (API/Worker aplicam migrations na inicialização).

## Compatibilidade

- Mantenha `--msbuildprojectextensionspath "$PWD/.codex-artifacts-local/obj/DAL"`:
  `Directory.Build.props` redireciona os intermediários de build para
  `.codex-artifacts-local/obj/<projeto>`.
- EF Core/ferramenta: `8.0.8` / SDK `8.0.416` (VPS). Não altere versões de pacote por esta via.
