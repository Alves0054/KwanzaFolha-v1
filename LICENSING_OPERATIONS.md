# Licensing Operations - Kwanza Folha

## Endpoints principais

- `POST /payment/create`
- `POST /payment/status`
- `POST /payment/webhook`
- `POST /license/activate`
- `POST /install/register`
- `POST /install/heartbeat`
- `POST /install/validate`
- `GET /health`

## Regras operacionais

- HTTPS obrigatorio em producao
- endpoint publico `/payment/confirm` desativado (403)
- rate limiting ativo para rotas sensiveis/admin
- vendas podem ser suspensas por configuracao (`sales.enabled = false`)

## Ciclo de ativacao

1. app cria referencia (`/payment/create`)
2. pagamento confirmado (webhook/admin)
3. cliente ativa com serial (`/license/activate`)
4. app guarda token local protegido e associa instalacao
5. heartbeats de instalacao mantem estado

## Falhas frequentes

- DNS/HTTPS indisponivel
- serial invalido ou associado a outro dispositivo
- pagamento ainda pendente
- alteracao suspeita de hardware/instalacao

## Monitorizacao minima

- consultar `/health` periodicamente
- monitorar `pendingPayments`, `activeLicenses`, `queuedInvoiceEmails`
- monitorar taxa de erro em `licensing.activate` e `licensing.payment.*`

## Seguranca operacional

- nao expor chave privada no repositorio
- nao guardar credenciais em texto claro
- manter secrets apenas em ambiente seguro (CI/host)
- rodar chave/certificado conforme politica de expiracao
