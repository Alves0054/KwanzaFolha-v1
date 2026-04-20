# Publicação Cloud - license.alvesestudio.ao

## 0) DNS obrigatório (antes de tudo)
Criar registo DNS para o subdomínio:
- Tipo: `A`
- Nome: `license`
- Valor: IP público do teu alojamento
- TTL: `300`

Validar:

```bash
nslookup license.alvesestudio.ao
```

## 1) Preparar ficheiros no servidor
- Copiar a pasta `licensing-server/` para a cloud.
- Garantir que existe `storage/keys/license-private.pem` (chave privada de licenciamento).
- Copiar `config/settings.production.example.json` para `config/settings.json` e editar os valores reais.

## 2) Onde colocar os dados bancários (recebimento)
Editar este bloco no ficheiro:
- `licensing-server/config/settings.json`
- secção: `"paymentInstructions"`

Campos usados pela app no ecrã de pagamento:
- `bankName`
- `accountName`
- `iban`
- `accountNumber`
- `entity`
- `referenceLabel`
- `supportEmail`
- `supportPhone`
- `notes`

Também pode configurar sem editar `settings.json` usando variáveis de ambiente:
- `KWANZA_PAYMENT_BANK_NAME`
- `KWANZA_PAYMENT_ACCOUNT_NAME`
- `KWANZA_PAYMENT_IBAN`
- `KWANZA_PAYMENT_ACCOUNT_NUMBER`
- `KWANZA_PAYMENT_ENTITY`
- `KWANZA_PAYMENT_REFERENCE_LABEL`
- `KWANZA_PAYMENT_SUPPORT_EMAIL`
- `KWANZA_PAYMENT_SUPPORT_PHONE`
- `KWANZA_PAYMENT_NOTES`

Exemplo direto:

```json
"paymentInstructions": {
  "bankName": "Banco ATLANTICO",
  "accountName": "Alves Estudio",
  "iban": "AO06....",
  "accountNumber": "000000000000",
  "entity": "00000",
  "referenceLabel": "Referencia",
  "supportEmail": "suporte@alvesestudio.ao",
  "supportPhone": "+244900000000",
  "notes": "Depois do pagamento, clique em Verificar pagamento no aplicativo."
}
```

## 3) Subir o serviço Node na cloud
Comandos:

```bash
cd /var/www/kwanza-folha
npm ci --omit=dev
node licensing-server/server.js
```

Recomendado em produção com PM2:

```bash
pm2 start licensing-server/server.js --name kwanza-license
pm2 save
pm2 startup
```

## 4) Proxy reverso para o subdomínio
Configurar `license.alvesestudio.ao` para encaminhar para `127.0.0.1:3055`.
Obrigatório enviar header:
- `X-Forwarded-Proto: https`

Com isso, o servidor aceita HTTP interno e exige HTTPS público.

## 5) Verificação rápida
Após publicar:

```bash
curl -s https://license.alvesestudio.ao/health
curl -s https://license.alvesestudio.ao/plans
```

Ambos devem responder `ok: true`.

## 6) Fluxo de ativação esperado
1. App gera referência em `/payment/create`
2. Pagamento confirmado via webhook ou `/admin/payment/confirm`
3. App verifica `/payment/status`
4. App ativa em `/license/activate`

Se o pagamento ficar em `pending`, a ativação não conclui até confirmação.
