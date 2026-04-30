# Guia de Publicação, Licenciamento e Plano Financeiro

Este documento explica como colocar o **Kwanza Folha** online, como funciona o ciclo completo da licença e como estruturar um plano financeiro inicial para operar o produto como software pago.

## 1. Como colocar o Kwanza Folha online

O projeto tem duas frentes principais:

1. o **aplicativo desktop**
2. o **servidor de licenciamento**

Opcionalmente, tens também:

3. o **site público de apresentação**

### 1.1. O que vai para o servidor

Para produção, deves publicar:

- o servidor de licenciamento em [licensing-server/server.js](/C:/Users/nunes/Documents/Pagamentos/licensing-server/server.js)
- a configuração do servidor em `licensing-server/config/settings.json`
- a base de dados do licenciamento em `licensing-server/storage/licensing.sqlite`
- a pasta de faturas em `licensing-server/storage/invoices`
- o site público em [site-kwanzafolha](/C:/Users/nunes/Documents/Pagamentos/site-kwanzafolha)

O aplicativo desktop não fica “hospedado” como sistema web. Ele é distribuído como instalador:

- [KwanzaFolha-Setup-1.0.0.exe](/C:/Users/nunes/Documents/Pagamentos/dist-electron/KwanzaFolha-Setup-1.0.0.exe)

### 1.2. Estrutura recomendada de produção

Podes usar esta estrutura:

- `app.kwanzafolha.ao` ou `www.kwanzafolha.ao` para o site
- `license.kwanzafolha.ao` para o servidor de licenciamento
- `download.kwanzafolha.ao` ou a própria pasta `downloads` do site para o instalador

### 1.3. Passos práticos para publicar

#### A. Publicar o site

1. Copia a pasta [site-kwanzafolha](/C:/Users/nunes/Documents/Pagamentos/site-kwanzafolha) para o servidor.
2. Garante que o instalador está na pasta `downloads` do site.
3. Liga o domínio ao servidor.
4. Ativa HTTPS no domínio público.

#### B. Publicar o servidor de licenciamento

1. Coloca o projeto num servidor com Node.js.
2. Executa `npm install`.
3. Arranca o servidor com `npm run license:server`.
4. Na primeira execução será criado `licensing-server/config/settings.json`.
5. Preenche esse ficheiro com:
   - host e porta do servidor
   - HTTPS
   - SMTP
   - dados do emissor das faturas

#### C. Configurar HTTPS

O servidor já suporta HTTP e HTTPS.

Em [server.js](/C:/Users/nunes/Documents/Pagamentos/licensing-server/server.js), o sistema lê:

- `settings.https.enabled`
- `settings.https.keyPath`
- `settings.https.certPath`

Quando ativares isso e colocares os ficheiros do certificado, o servidor passa a responder por HTTPS.

#### D. Ligar o aplicativo desktop ao servidor real

O desktop hoje lê a API em:

- [license-source.js](/C:/Users/nunes/Documents/Pagamentos/electron/config/license-source.js)

Atualmente o valor está local:

- `http://127.0.0.1:3055`

Em produção, deves trocar para algo como:

- `https://license.kwanzafolha.ao`

Ou então definir por variável de ambiente:

- `KWANZA_LICENSE_API_URL=https://license.kwanzafolha.ao`

#### E. Publicar a build final

Depois de apontares o desktop para o servidor real:

1. gera a build
2. gera a build assinada
3. sobe o instalador para o site

### 1.4. O que ainda tens de garantir em produção

Antes de lançar comercialmente, garante:

- domínio ativo
- HTTPS ativo
- SMTP real configurado
- backups automáticos do `licensing.sqlite`
- backups da pasta `invoices`
- URL real da API no desktop
- build assinada

## 2. Como funciona a licença do Kwanza Folha, do início ao fim

Hoje o projeto já faz quase todo o ciclo.

### 2.1. Fluxo comercial atual

1. o cliente instala o aplicativo
2. regista a empresa e o primeiro administrador
3. começa um período gratuito de 15 dias
4. durante esses 15 dias pode usar o sistema normalmente
5. quando o teste termina, o app bloqueia
6. o cliente compra ou ativa a licença
7. depois da ativação, o sistema funciona offline até à data de expiração

### 2.2. Compra da licença

No app, o utilizador abre:

- `Comprar licença`

Depois informa:

- empresa
- NIF
- e-mail
- telefone

O aplicativo chama:

- `POST /payment/create`

Esse endpoint está no servidor em [server.js](/C:/Users/nunes/Documents/Pagamentos/licensing-server/server.js).

O servidor:

1. cria ou atualiza o cliente na tabela `users`
2. cria um registo `pending` em `payments`
3. gera:
   - `reference`
   - `amount`
   - `valid_until`

### 2.3. Pagamento por referência

Depois da referência ser gerada:

1. o cliente paga
2. o pagamento precisa de ser confirmado

Hoje o projeto suporta duas formas:

- confirmação manual pelo painel admin
- chamada direta ao endpoint `POST /payment/confirm`

### 2.4. O que acontece quando o pagamento é confirmado

Quando o pagamento muda para `paid`, o servidor faz automaticamente:

1. gera ou renova a licença
2. gera o serial
3. grava a licença na tabela `licenses`
4. marca o pagamento como pago
5. gera a fatura PDF
6. envia o e-mail ao cliente

### 2.5. Geração do serial

O serial é gerado no servidor com SHA-256 e formato:

- `KWZ-XXXX-XXXX-XXXX-XXXX`

Isso é feito em [server.js](/C:/Users/nunes/Documents/Pagamentos/licensing-server/server.js) no método `generateSerialKey`.

### 2.6. Ativação da licença no aplicativo

Depois de receber o serial por e-mail, o cliente abre:

- `Inserir licença`

E informa:

- e-mail
- serial

O aplicativo chama:

- `POST /license/activate`

Além do e-mail e serial, o desktop envia também:

- `device_hash`
- `device_name`
- `app_version`
- `integrity`

### 2.7. Como o servidor valida a ativação

O servidor valida:

1. se o cliente existe
2. se o serial existe
3. se a licença pertence àquele e-mail
4. se a licença está ativa
5. se a licença não expirou
6. se o dispositivo já está registado

Se estiver tudo certo:

1. associa a licença ao dispositivo
2. assina digitalmente o token da licença
3. devolve:
   - `license_token`
   - `expire_date`
   - `plan`
   - `serial_key`

### 2.8. Como a licença fica guardada localmente

O desktop guarda a licença em:

- `license.json`

Essa licença é cifrada com AES em [licensing.js](/C:/Users/nunes/Documents/Pagamentos/electron/services/licensing.js).

O conteúdo local guarda:

- token assinado
- data de expiração
- plano
- serial
- dados de integridade

### 2.9. Como o app funciona offline

Depois da ativação:

1. o app lê a licença local
2. valida a assinatura digital
3. valida o `device_hash`
4. valida a integridade do executável e dos ficheiros críticos
5. verifica a data de expiração

Se estiver tudo válido:

- o sistema continua a funcionar offline

Se expirar:

- o acesso é bloqueado

Mensagem atual:

- `Sua licença do KwanzaFolha expirou. Renove para continuar usando o sistema.`

### 2.10. Como a renovação funciona

Dentro do app:

- `Renovar licença`

O fluxo é praticamente o mesmo:

1. gerar nova referência
2. pagar
3. confirmar pagamento
4. prolongar a validade da licença em mais 30 dias

## 3. O que já está pronto e o que falta para fechar 100%

### 3.1. Já está pronto

- registo inicial da empresa
- 15 dias gratuitos
- bloqueio após expiração do teste
- compra da licença no app
- geração de referência
- serial automático
- ativação por e-mail + serial
- associação ao dispositivo
- licença local cifrada
- validação offline
- geração de fatura
- envio de e-mail
- painel administrativo base

### 3.2. O que falta para produção total

O principal ponto pendente não é a lógica do app, é a infraestrutura real:

- publicar o servidor de licenciamento
- ativar HTTPS real
- configurar SMTP real
- mudar a URL local para a URL pública
- ligar a confirmação do pagamento ao meio de pagamento real

### 3.3. O ponto mais importante da automação

Hoje o sistema já consegue criar a referência e confirmar pagamento por endpoint.

Para ficar totalmente automático, deves integrar o teu banco/gateway assim:

1. o Kwanza Folha gera a referência
2. o cliente paga
3. o banco ou o gateway chama o teu webhook
4. o teu webhook chama internamente a lógica de confirmação
5. o servidor marca `payment.status = paid`
6. o resto acontece automaticamente

Em termos práticos, o ideal é criar:

- `POST /payment/webhook`

Esse endpoint:

1. recebe o retorno do banco/gateway
2. valida a autenticidade do retorno
3. confirma a referência
4. chama a rotina de `confirmPayment`

Hoje isso ainda pode ser feito por confirmação administrativa manual, mas em produção o melhor é automatizar.

## 4. Plano financeiro inicial do Kwanza Folha

O plano abaixo é uma proposta realista para começar a operar comercialmente.

### 4.1. Receita do produto

Planos comerciais:

- **Starter** — 7.500 Kz/mês (até 10 funcionários, até 1 PC/dispositivo)
- **Básico** — 12.500 Kz/mês (até 25 funcionários, até 2 PCs/dispositivos)
- **Profissional** — 15.000 Kz/mês (até 50 funcionários, até 3 PCs/dispositivos)
- **Empresa** — 28.000 Kz/mês (até 100 funcionários, até 4 PCs/dispositivos)
- **Business** — 48.500 Kz/mês (até 200 funcionários, até 6 PCs/dispositivos)

### 4.2. Estrutura financeira recomendada

Vou dividir em:

- custos fixos
- custos variáveis
- ponto de equilíbrio
- cenários de lucro

## 4.3. Custos fixos mensais recomendados

### Infraestrutura

- servidor do licenciamento e base de dados: **35.000 Kz**
- backups e armazenamento: **10.000 Kz**
- domínio e SSL rateados por mês: **5.000 Kz**
- SMTP / correio transacional: **12.000 Kz**
- monitorização e suporte técnico base: **8.000 Kz**

Subtotal infraestrutura:

- **70.000 Kz / mês**

### Operação

- internet, chamadas e comunicação: **20.000 Kz**
- apoio administrativo / contabilístico: **25.000 Kz**
- deslocações e custos comerciais: **40.000 Kz**
- apoio ao cliente / suporte operacional: **80.000 Kz**

Subtotal operação:

- **165.000 Kz / mês**

### Estrutura

- renda / partilha de espaço de trabalho: **60.000 Kz**
- despesas gerais e imprevistos: **15.000 Kz**

Subtotal estrutura:

- **75.000 Kz / mês**

### Total fixo mensal

- **310.000 Kz / mês**

## 4.4. Custos variáveis

Recomendo considerar:

- taxa média de cobrança/pagamento: **5%**

Em cada cliente de `15.000 Kz`, assume:

- custo variável médio: **750 Kz**
- receita líquida por cliente: **14.250 Kz**

## 4.5. Ponto de equilíbrio

Fórmula:

- `custos fixos / receita líquida por cliente`

Logo:

- `310.000 / 14.250 = 21,75`

Ponto de equilíbrio recomendado:

- **22 clientes pagantes**

## 4.6. Cenários de faturação e lucro mensal

### Cenário 1: 10 clientes

- faturação bruta: **150.000 Kz**
- custo variável estimado: **7.500 Kz**
- margem após variável: **142.500 Kz**
- resultado mensal: **-167.500 Kz**

### Cenário 2: 25 clientes

- faturação bruta: **375.000 Kz**
- custo variável estimado: **18.750 Kz**
- margem após variável: **356.250 Kz**
- resultado mensal: **46.250 Kz**

### Cenário 3: 50 clientes

- faturação bruta: **750.000 Kz**
- custo variável estimado: **37.500 Kz**
- margem após variável: **712.500 Kz**
- resultado mensal: **402.500 Kz**

### Cenário 4: 100 clientes

- faturação bruta: **1.500.000 Kz**
- custo variável estimado: **75.000 Kz**
- margem após variável: **1.425.000 Kz**
- resultado mensal: **1.115.000 Kz**

## 4.7. Equipa mínima recomendada

### Estrutura inicial enxuta

- **Adérito Alves**
  - produto
  - visão técnica
  - acompanhamento comercial

- **Alves Estúdio**
  - operação empresarial
  - marca
  - relação com clientes

- **1 apoio operacional parcial**
  - suporte ao cliente
  - ativação
  - faturação
  - acompanhamento de pagamentos

## 4.8. Modelo de operação recomendado

### Fase 1: operação enxuta

Objetivo:

- vender
- validar o produto
- estabilizar a operação

Meta:

- chegar a **25 clientes**

### Fase 2: expansão controlada

Objetivo:

- criar processo comercial repetível
- reforçar suporte
- automatizar mais pagamentos e ativações

Meta:

- chegar a **50 clientes**

### Fase 3: escala

Objetivo:

- fortalecer marca
- ganhar presença empresarial
- aumentar carteira recorrente

Meta:

- passar de **100 clientes**

## 5. O que eu recomendo como próximos passos

### Prioridade 1

- publicar o servidor de licenciamento
- ativar HTTPS
- configurar SMTP
- trocar a API local pela URL pública

### Prioridade 2

- ligar a confirmação do pagamento ao canal real de cobrança
- automatizar o webhook
- testar compra, e-mail, serial e ativação ponta a ponta

### Prioridade 3

- fazer a build final assinada
- subir o instalador para o site
- publicar a página comercial

### Prioridade 4

- definir meta comercial mensal
- acompanhar:
  - número de clientes
  - clientes em teste
  - clientes ativos
  - renovações
  - receita mensal recorrente

## 6. Resumo executivo

O Kwanza Folha já tem a base técnica necessária para operar como software pago:

- compra de licença
- referência de pagamento
- serial
- ativação
- fatura
- e-mail
- validação offline
- bloqueio por expiração

Para ficar totalmente pronto para mercado, o trabalho principal agora é:

- infraestrutura online
- automação da confirmação do pagamento
- publicação comercial
- operação financeira e suporte
