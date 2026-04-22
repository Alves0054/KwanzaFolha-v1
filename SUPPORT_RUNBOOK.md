# Support Runbook - Kwanza Folha

## Objetivo

Guia operativo para suporte de 1a linha e 2a linha em falhas de desktop/licenciamento.

## Coleta minima de evidencias

1. pedir versao da app (`app:get-version`)
2. exportar bundle de suporte (IPC `support:export-logs`)
3. recolher print da mensagem de erro exibida
4. recolher periodo/funcionario afetado (se aplicavel)

## Falha de ativacao de licenca

- verificar conectividade HTTPS para servidor de licenciamento
- validar e-mail e serial informados
- verificar estado de pagamento no servidor
- consultar eventos `licensing.*` no `operations-events.jsonl`

## Licenca expirada

- confirmar data de expiracao devolvida por `license:get-status`
- iniciar renovacao por referencia (`license:renew`)
- apos pagamento, executar `license:check-payment` e `license:activate`

## Servidor de licenciamento indisponivel

- consultar `GET /health`
- verificar TLS/proxy reverso e DNS
- verificar fila de e-mails/faturas no health (`queuedInvoiceEmails`)

## Erro SMTP/webhook

- validar configuracao SMTP no servidor
- validar secret do webhook e payload recebido
- validar se pagamento foi confirmado e se houve tentativa de envio de fatura

## Recuperacao de base local

- usar backup oficial via fluxo de restauro
- se houver erro de arranque DB, recolher snapshot em `Diagnostico/StartupRecovery`
- nao editar ficheiros sqlite manualmente em producao
