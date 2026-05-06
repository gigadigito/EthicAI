# CriptoVersus Social X Workflow

Este diretório contém o workflow importável do n8n para automação social do CriptoVersus:

- [criptoversus-social-x-workflow.json](C:/EthicAI/EthicAI/Itens%20de%20Solu%C3%A7%C3%A3o/n8n/criptoversus-social-x-workflow.json)

## Como importar no n8n

1. Abra o n8n.
2. Clique em `Workflows`.
3. Escolha `Import from File`.
4. Selecione `criptoversus-social-x-workflow.json`.
5. Revise os nodes, credenciais e variáveis antes de executar.

## Variáveis de ambiente necessárias

Configure estas variáveis no ambiente do n8n:

- `CRIPTOVERSUS_API_BASE_URL`
  Exemplo: `https://sua-api.exemplo.com`

- `BROWSERLESS_BASE_URL`
  Exemplo: `https://chrome.browserless.io`

- `BROWSERLESS_TOKEN`
  Token do Browserless usado no node de screenshot.

Observação:

- O workflow não inclui segredos reais.
- As credenciais do X e da OpenAI devem ser configuradas manualmente no n8n.

## Credenciais que precisam ser criadas no n8n

Crie ou ajuste estas credenciais:

- `OpenAI API`
  Use no node `OpenAI - Gerar Narração`.
  O node está preparado para chamar `https://api.openai.com/v1/responses`.

- `X / Twitter`
  Use no node `X - Publicar Post (Texto + Link)`.
  Configure manualmente conforme o tipo de credencial suportado pela sua instância do n8n.

- `OAuth 1.0a` opcional para upload de mídia
  Se você quiser publicar a imagem gerada pelo Browserless via API HTTP, ajuste o node `X - Media Upload via HTTP (Opcional)`.

## Como testar primeiro com Manual Trigger

1. Importe o workflow.
2. Preencha as variáveis de ambiente.
3. Configure a credencial da OpenAI.
4. Durante os testes iniciais, desative o node `X - Publicar Post (Texto + Link)` para evitar postagem real.
5. Execute o workflow pelo `Manual Trigger`.
6. Verifique:
   - se `HTTP Request - Hot Matches` retornou partidas
   - se `HTTP Request - Share Card` trouxe `canPost`
   - se `HTTP Request - Screenshot Browserless` retornou binário PNG
   - se `OpenAI - Gerar Narração` gerou texto curto

## Como ativar o Cron depois

O node `Cron Trigger` já está configurado para rodar a cada 15 minutos, mas foi deixado desativado.

Para ativar:

1. Abra o workflow.
2. Habilite o node `Cron Trigger`.
3. Ative o workflow no n8n.
4. Confirme se a instância do n8n está com as variáveis de ambiente corretas.

## Como validar se o post foi registrado na API

Depois que a execução passar pelo node `HTTP Request - Registrar Postagem`, confirme:

1. se a chamada respondeu com sucesso
2. se a API retornou um `id` de registro
3. se a tabela `social_post_history` recebeu o item correspondente

Campos esperados no registro:

- `matchId`
- `platform = X`
- `postText`
- `postUrl`
- `externalPostId`
- `hotScore`
- `reason`

## Como desativar temporariamente a postagem real no X

Durante testes, você pode impedir postagem real de três formas:

1. Desativar o node `X - Publicar Post (Texto + Link)`.
2. Executar apenas até os nodes de API, Browserless e OpenAI.
3. Duplicar o workflow e manter uma versão exclusiva para homologação.

## Observações importantes

- A primeira versão está preparada para funcionar bem com texto + link.
- O screenshot já é gerado pelo Browserless e fica disponível no fluxo como binário.
- O upload da imagem para o X pode exigir ajuste adicional com OAuth 1.0a, dependendo do método que você quiser usar.
- Se preferir, você pode manter a primeira fase postando apenas texto, link e hashtags, e habilitar mídia depois.
