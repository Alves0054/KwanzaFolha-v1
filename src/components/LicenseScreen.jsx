import AppIcon from "./AppIcon";
import brandLogo from "../assets/logos/logo-light.png";

function formatKz(value) {
  return `${Number(value || 0).toLocaleString("pt-PT")} Kz`;
}

const FALLBACK_PLAN = {
  code: "profissional",
  name: "Profissional",
  price: 15000,
  periodDays: 30,
  maxEmployees: 50,
  maxDevices: 3,
  features: [
    "Até 50 funcionários ativos",
    "Até 3 PCs/dispositivos por licença",
    "Validade de 30 dias",
    "Renovação mensal"
  ]
};

export default function LicenseScreen({
  licenseState,
  plans,
  licenseMode,
  setLicenseMode,
  activationForm,
  setActivationForm,
  purchaseForm,
  setPurchaseForm,
  paymentState,
  handleActivateLicense,
  handleCreateLicensePayment,
  handleCheckLicensePayment,
  handleClose,
  feedback,
  embedded = false
}) {
  const isDeveloperActive = licenseState?.status === "developer_active";
  const isExpired = licenseState?.status === "expired";
  const isTrialExpired = licenseState?.status === "trial_expired";
  const availablePlans = plans?.length ? plans : [FALLBACK_PLAN];
  const selectedPlanCode = String(purchaseForm?.plan || availablePlans?.[0]?.code || FALLBACK_PLAN.code).trim().toLowerCase();
  const selectedPlan = availablePlans.find((candidate) => candidate.code === selectedPlanCode) || availablePlans[0] || FALLBACK_PLAN;
  const plan = selectedPlan;

  const title = isDeveloperActive
    ? "LICENÇA TÉCNICA DE DESENVOLVIMENTO"
    : isExpired
      ? "LICENÇA EXPIRADA"
      : isTrialExpired
        ? "PERÍODO GRATUITO TERMINADO"
        : "ATIVAR LICENÇA";

  const description = isDeveloperActive
    ? "Esta instalação local está em modo técnico de desenvolvimento para permitir edição, testes e manutenção do sistema sem bloqueio comercial."
    : isExpired
      ? "Sua licença do Kwanza Folha expirou. Renove para continuar usando o sistema."
      : isTrialExpired
        ? "Os 15 dias gratuitos já terminaram. Para continuar, renove ou compre um plano mensal."
        : "Ative a sua licença ou conclua a compra/renovação do plano mensal para continuar a usar o Kwanza Folha.";

  const returnMode = isExpired ? "renew" : "purchase";
  const paymentInstructions = paymentState?.paymentInstructions || {};
  const hasPaymentInstructions = Boolean(
    paymentInstructions.bankName ||
      paymentInstructions.accountName ||
      paymentInstructions.iban ||
      paymentInstructions.accountNumber ||
      paymentInstructions.entity ||
      paymentInstructions.supportEmail ||
      paymentInstructions.supportPhone ||
      paymentInstructions.notes
  );

  const shellClassName = embedded ? "license-overlay-shell" : "auth-shell auth-shell--license-gate";
  const noteText = embedded
    ? "Pode fechar esta janela e voltar às Configurações. A licença atual do sistema mantém-se até nova ativação ou renovação."
    : "Fechar este aviso termina o aplicativo. Sem uma licença válida, o Kwanza Folha continuará bloqueado ao voltar a abrir.";

  const normalizedLicenseMessage = String(licenseState?.message || "").trim().toLowerCase();
  const normalizedFeedback = String(feedback || "").trim().toLowerCase();
  const showStandaloneFeedback = Boolean(normalizedFeedback && normalizedFeedback !== normalizedLicenseMessage);

  return (
    <div className={shellClassName}>
      <div className="modal-backdrop" />

      <div className="modal">
        <div className="auth-card auth-card--split license-modal">
          <button
            type="button"
            className="license-modal__close"
            onClick={handleClose}
            aria-label="Fechar o aplicativo"
          >
            ×
          </button>

          <div className="auth-card__brand">
            <span className="topbar-eyebrow">Licenciamento empresarial</span>
            <img className="brand-logo auth-brand-logo" src={brandLogo} alt="Kwanza Folha" />
            <h1>{title}</h1>
            <p>{description}</p>
            <small className="auth-brand-credit">Criado por Adérito Alves e pela empresa Alves Estúdio.</small>

            {isDeveloperActive && (
              <div className="feedback feedback--info">
                Licença técnica válida até {licenseState?.expireDate || "-"}. Este modo serve apenas para desenvolvimento local.
              </div>
            )}

            {(isExpired || isTrialExpired) && (
              <div className="feedback feedback--warning">
                {licenseState?.message || "É necessária uma licença válida para continuar a usar o sistema."}
              </div>
            )}

            <div className="auth-highlights">
              <div className="auth-highlight">
                <span className="auth-highlight__icon">
                  <AppIcon name="reports" size={18} />
                </span>
                <div className="auth-highlight__content">
                  <strong>{plan.name}</strong>
                  <small>{formatKz(plan.price)} por mês, com acesso completo ao sistema.</small>
                </div>
              </div>

              <div className="auth-highlight">
                <span className="auth-highlight__icon">
                  <AppIcon name="audit" size={18} />
                </span>
                <div className="auth-highlight__content">
                  <strong>Funcionamento offline</strong>
                  <small>Depois da ativação, o aplicativo continua a funcionar offline até à data de expiração.</small>
                </div>
              </div>

              <div className="auth-highlight">
                <span className="auth-highlight__icon">
                  <AppIcon name="settings" size={18} />
                </span>
                <div className="auth-highlight__content">
                  <strong>Proteção por dispositivo</strong>
                  <small>A licença fica associada ao equipamento ativado e bloqueia reutilização indevida.</small>
                </div>
              </div>

              {isDeveloperActive && (
                <div className="auth-highlight">
                  <span className="auth-highlight__icon">
                    <AppIcon name="shield" size={18} />
                  </span>
                  <div className="auth-highlight__content">
                    <strong>Modo técnico local</strong>
                    <small>Licença temporária de desenvolvimento ativa para esta instalação de trabalho.</small>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="auth-card__form">
            {isDeveloperActive && (
              <div className="section-heading compact">
                <h3>Estado da licença atual</h3>
                <p>
                  A aplicação está desbloqueada em modo técnico até {licenseState?.expireDate || "-"}.
                  A ativação comercial continua disponível quando quiser validar o fluxo de cliente final.
                </p>
              </div>
            )}

            <div className="auth-tabs" role="tablist" aria-label="Licença">
              <button
                type="button"
                className={licenseMode === "activate" ? "auth-tab auth-tab--active" : "auth-tab"}
                onClick={() => setLicenseMode("activate")}
              >
                {isExpired ? "Inserir nova licença" : "Inserir licença"}
              </button>

              {!isExpired && !isDeveloperActive && (
                <button
                  type="button"
                  className={licenseMode === "purchase" ? "auth-tab auth-tab--active" : "auth-tab"}
                  onClick={() => setLicenseMode("purchase")}
                >
                  Comprar licença
                </button>
              )}

              {isExpired && !isDeveloperActive && (
                <button
                  type="button"
                  className={licenseMode === "renew" ? "auth-tab auth-tab--active" : "auth-tab"}
                  onClick={() => setLicenseMode("renew")}
                >
                  Renovar licença
                </button>
              )}
            </div>

            {licenseMode === "activate" && (
              <>
                <div className="section-heading compact">
                  <h3>Ativar licença</h3>
                  <p>Introduza o e-mail do cliente e o serial recebido para desbloquear o sistema neste dispositivo.</p>
                </div>

                <form className="auth-form" onSubmit={handleActivateLicense}>
                  <label>
                    E-mail
                    <input
                      value={activationForm.email}
                      onChange={(event) => setActivationForm((current) => ({ ...current, email: event.target.value }))}
                      placeholder="cliente@empresa.ao"
                    />
                  </label>

                  <label>
                    Serial da licença
                    <input
                      value={activationForm.serialKey}
                      onChange={(event) => setActivationForm((current) => ({ ...current, serialKey: event.target.value }))}
                      placeholder="KWZ-XXXX-XXXX-XXXX-XXXX"
                    />
                  </label>

                  <button type="submit">Ativar licença</button>
                </form>
              </>
            )}

            {(licenseMode === "purchase" || licenseMode === "renew") && !isDeveloperActive && (
              <>
                <div className="section-heading compact">
                  <h3>{licenseMode === "renew" ? "Renovar licença" : "Comprar licença"}</h3>
                  <p>Preencha os dados da empresa para gerar a referência de pagamento da assinatura mensal.</p>
                </div>

                <div className="license-plan-grid" role="list">
                  {availablePlans.map((candidate) => {
                    const isActive = candidate.code === selectedPlanCode;
                    return (
                      <button
                        key={candidate.code}
                        type="button"
                        className={isActive ? "license-plan-card license-plan-card--active" : "license-plan-card"}
                        onClick={() =>
                          setPurchaseForm((current) => ({
                            ...current,
                            plan: candidate.code
                          }))
                        }
                      >
                        <div className="license-plan-card__headline">
                          <strong>{candidate.name}</strong>
                          <span>{formatKz(candidate.price)} por mês</span>
                        </div>
                        <small className="license-plan-card__meta">
                          Validade de {candidate.periodDays || 30} dias com renovação mensal.
                        </small>
                        <ul className="license-plan-features">
                          {(candidate.features || FALLBACK_PLAN.features).map((feature) => (
                            <li key={feature}>{feature}</li>
                          ))}
                        </ul>
                      </button>
                    );
                  })}
                </div>

                <form className="auth-form auth-form--register" onSubmit={handleCreateLicensePayment}>
                  <div className="auth-form-grid">
                    <label>
                      Empresa
                      <input
                        value={purchaseForm.empresa}
                        onChange={(event) => setPurchaseForm((current) => ({ ...current, empresa: event.target.value }))}
                        placeholder="Introduza o nome da empresa"
                      />
                    </label>

                    <label>
                      NIF
                      <input
                        value={purchaseForm.nif}
                        onChange={(event) => setPurchaseForm((current) => ({ ...current, nif: event.target.value }))}
                        placeholder="Introduza o NIF"
                      />
                    </label>

                    <label>
                      E-mail
                      <input
                        value={purchaseForm.email}
                        onChange={(event) => setPurchaseForm((current) => ({ ...current, email: event.target.value }))}
                        placeholder="cliente@empresa.ao"
                      />
                    </label>

                    <label>
                      Telefone
                      <input
                        value={purchaseForm.telefone}
                        onChange={(event) => setPurchaseForm((current) => ({ ...current, telefone: event.target.value }))}
                        placeholder="923000000"
                      />
                    </label>
                  </div>

                  <button type="submit">
                    {licenseMode === "renew" ? "Gerar referência de renovação" : "Gerar referência de pagamento"}
                  </button>
                </form>
              </>
            )}

            {licenseMode === "payment" && !isDeveloperActive && (
              <>
                <div className="section-heading compact">
                  <h3>Pagamento por referência</h3>
                  <p>Pague a referência abaixo e depois confirme o estado do pagamento no aplicativo.</p>
                </div>

                <div className="license-payment-card">
                  <div>
                    <label>Referência</label>
                    <strong>{paymentState.reference || "-"}</strong>
                  </div>

                  <div>
                    <label>Valor</label>
                    <strong>{formatKz(paymentState.amount)}</strong>
                  </div>

                  <div>
                    <label>Plano</label>
                    <strong>{paymentState.planName || plan.name}</strong>
                  </div>

                  <div>
                    <label>Válido até</label>
                    <strong>{paymentState.validUntil ? new Date(paymentState.validUntil).toLocaleString("pt-PT") : "-"}</strong>
                  </div>
                </div>

                {hasPaymentInstructions && (
                  <div className="auth-note">
                    <strong>Dados bancários para pagamento</strong>
                    <br />
                    {paymentInstructions.bankName ? `Banco: ${paymentInstructions.bankName}` : ""}
                    {paymentInstructions.accountName ? ` | Titular: ${paymentInstructions.accountName}` : ""}
                    {paymentInstructions.entity ? ` | Entidade: ${paymentInstructions.entity}` : ""}
                    {paymentInstructions.accountNumber ? ` | Conta: ${paymentInstructions.accountNumber}` : ""}
                    {paymentInstructions.iban ? ` | IBAN: ${paymentInstructions.iban}` : ""}
                    {paymentInstructions.supportPhone ? ` | Suporte: ${paymentInstructions.supportPhone}` : ""}
                    {paymentInstructions.supportEmail ? ` | E-mail: ${paymentInstructions.supportEmail}` : ""}
                    {paymentInstructions.notes ? (
                      <>
                        <br />
                        {paymentInstructions.notes}
                      </>
                    ) : null}
                  </div>
                )}

                <div className="inline-actions">
                  <button type="button" className="secondary-btn" onClick={() => setLicenseMode(returnMode)}>
                    Voltar
                  </button>
                  <button type="button" onClick={handleCheckLicensePayment}>
                    Verificar pagamento
                  </button>
                </div>
              </>
            )}

            <div className="auth-note">{noteText}</div>

            {showStandaloneFeedback && (
              <div className={`feedback ${isExpired || isTrialExpired ? "feedback--warning" : "feedback--info"}`}>
                {feedback}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
