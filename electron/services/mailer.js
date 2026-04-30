const nodemailer = require("nodemailer");

function isValidEmail(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(normalized);
}

class MailerService {
  constructor({ database, licensing = null, productName = "Kwanza Folha" }) {
    this.database = database;
    this.licensing = licensing;
    this.productName = productName;
  }

  getMailConfig() {
    const settings = this.database.getSystemSettings();
    const company = this.database.getCompanyProfile() || {};
    const getEnv = (name) => String(process.env[name] || "").trim();
    const envSecure = getEnv("KWANZA_SMTP_SECURE").toLowerCase();
    const secure =
      envSecure === "1" || envSecure === "true"
        ? true
        : envSecure === "0" || envSecure === "false"
          ? false
          : Boolean(settings.smtpSecure);

    return {
      host: getEnv("KWANZA_SMTP_HOST") || String(settings.smtpHost || "").trim(),
      port: Number(getEnv("KWANZA_SMTP_PORT") || settings.smtpPort || 0) || 587,
      secure,
      user: getEnv("KWANZA_SMTP_USER") || String(settings.smtpUser || "").trim(),
      password: getEnv("KWANZA_SMTP_PASSWORD") || String(settings.smtpPassword || "").trim(),
      fromName:
        getEnv("KWANZA_SMTP_FROM_NAME") || String(settings.smtpFromName || company.name || this.productName).trim(),
      fromEmail:
        getEnv("KWANZA_SMTP_FROM_EMAIL") ||
        String(settings.smtpFromEmail || company.email || settings.smtpUser || "").trim(),
      companyName: String(company.name || this.productName).trim() || this.productName
    };
  }

  validateMailConfig(config = this.getMailConfig()) {
    if (!config.host) {
      return { ok: false, message: "Configure o servidor SMTP nas configuracoes para enviar e-mails." };
    }
    if (!config.port || config.port <= 0) {
      return { ok: false, message: "Configure uma porta SMTP valida nas configuracoes." };
    }
    if (!config.user || !config.password) {
      return { ok: false, message: "Configure o utilizador e a palavra-passe SMTP nas configuracoes." };
    }
    if (!config.fromEmail || !isValidEmail(config.fromEmail)) {
      return { ok: false, message: "Configure um e-mail remetente valido nas configuracoes." };
    }
    return { ok: true, config };
  }

  createTransport(config) {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.password
      }
    });
  }

  async sendPasswordResetTokenOnline({ email, fullName, username, resetToken, expiresAt }) {
    if (!this.licensing?.getApiBaseUrl) {
      return { ok: false, message: "Servico online de e-mail indisponivel (licensing nao inicializado)." };
    }

    if (typeof fetch !== "function") {
      return { ok: false, message: "Esta versao nao suporta envio de e-mail via servico online." };
    }

    if (!isValidEmail(email)) {
      return { ok: false, message: "O utilizador nao tem um e-mail valido para receber o codigo de redefinicao." };
    }

    let apiBaseUrl = "";
    try {
      apiBaseUrl = String(this.licensing.getApiBaseUrl() || "").trim().replace(/\/+$/, "");
    } catch (error) {
      return { ok: false, message: error?.message || "URL do servidor online invalida." };
    }

    try {
      const fingerprint = this.licensing.getInstallationFingerprint?.() || {};
      const response = await fetch(`${apiBaseUrl}/mail/password-reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          product_name: this.productName,
          email,
          full_name: fullName || "",
          username: username || "",
          reset_token: resetToken || "",
          expires_at: expiresAt || "",
          install_id: fingerprint?.installId || "",
          fingerprint_hash: fingerprint?.fingerprintHash || ""
        })
      });

      if (!response.ok) {
        return { ok: false, message: "Nao foi possivel contactar o servico online de e-mail." };
      }

      const payload = await response.json().catch(() => ({}));
      if (!payload?.ok) {
        return { ok: false, message: payload?.message || "Falha ao enviar o e-mail de redefinicao via servico online." };
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: `Nao foi possivel enviar o e-mail via servico online: ${error?.message || "erro desconhecido"}.`
      };
    }
  }

  async sendPasswordResetTokenSmtp({ email, fullName, username, resetToken, expiresAt }) {
    const validation = this.validateMailConfig();
    if (!validation.ok) {
      return validation;
    }

    if (!isValidEmail(email)) {
      return { ok: false, message: "O utilizador nao tem um e-mail valido para receber o codigo de redefinicao." };
    }

    const config = validation.config;
    const transporter = this.createTransport(config);
    const expiryLabel = expiresAt ? new Date(expiresAt).toLocaleString("pt-PT") : "";
    const subject = `${config.companyName} - Codigo temporario de redefinicao`;
    const plainText = [
      `Ola ${fullName || username},`,
      "",
      "Foi solicitada a redefinicao da sua palavra-passe no sistema Kwanza Folha.",
      "Utilize o codigo temporario abaixo para definir uma nova palavra-passe no ecra de acesso:",
      "",
      `Utilizador: ${username}`,
      `Codigo de redefinicao: ${resetToken}`,
      expiryLabel ? `Valido ate: ${expiryLabel}` : "",
      "",
      "Por seguranca, este codigo so pode ser usado uma vez.",
      "Se nao reconhece este pedido, contacte o administrador do sistema.",
      "",
      `Mensagem automatica enviada por ${config.companyName}.`
    ].filter(Boolean).join("\n");

    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; color: #1b2742; line-height: 1.5;">
        <h2 style="color: #0c4da2; margin-bottom: 12px;">Codigo temporario de redefinicao</h2>
        <p>Ola <strong>${fullName || username}</strong>,</p>
        <p>Foi solicitada a redefinicao da sua palavra-passe no sistema <strong>${this.productName}</strong>.</p>
        <p>Utilize o codigo abaixo para definir uma nova palavra-passe no ecra de acesso:</p>
        <div style="background: #f4f7fb; border: 1px solid #d7e2f1; border-radius: 10px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0 0 8px 0;"><strong>Utilizador:</strong> ${username}</p>
          <p style="margin: 0 0 8px 0;"><strong>Codigo de redefinicao:</strong> ${resetToken}</p>
          ${expiryLabel ? `<p style="margin: 0;"><strong>Valido ate:</strong> ${expiryLabel}</p>` : ""}
        </div>
        <p>Por seguranca, este codigo so pode ser usado uma vez.</p>
        <p>Se nao reconhece este pedido, contacte o administrador do sistema.</p>
        <p style="color: #64748b; font-size: 12px; margin-top: 24px;">Mensagem automatica enviada por ${config.companyName}.</p>
      </div>
    `;

    try {
      await transporter.sendMail({
        from: `"${config.fromName}" <${config.fromEmail}>`,
        to: email,
        subject,
        text: plainText,
        html
      });

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: `Nao foi possivel enviar o e-mail com o codigo de redefinicao: ${error.message || "erro desconhecido"}.`
      };
    }
  }

  async sendPasswordResetToken(payload) {
    const onlineResult = await this.sendPasswordResetTokenOnline(payload || {});
    if (onlineResult.ok) {
      return onlineResult;
    }

    const canFallbackToSmtp = Boolean(
      String(process.env.KWANZA_SMTP_HOST || "").trim() ||
        String(process.env.KWANZA_SMTP_USER || "").trim() ||
        String(process.env.KWANZA_SMTP_PASSWORD || "").trim()
    );
    if (!canFallbackToSmtp) {
      return onlineResult;
    }

    return this.sendPasswordResetTokenSmtp(payload || {});
  }

  async sendPasswordResetCredentials(payload) {
    return this.sendPasswordResetToken(payload);
  }

  async sendTestEmail({ toEmail } = {}) {
    const validation = this.validateMailConfig();
    if (!validation.ok) {
      return validation;
    }

    const config = validation.config;
    const target = String(toEmail || config.fromEmail || "").trim();
    if (!isValidEmail(target)) {
      return { ok: false, message: "Indique um e-mail de destino válido para testar o SMTP." };
    }

    const transporter = this.createTransport(config);
    const subject = `${config.companyName} - Teste de SMTP`;
    const text = [
      "Teste de envio de e-mail (SMTP) do Kwanza Folha.",
      "",
      `Servidor: ${config.host}:${config.port}`,
      `Segurança (secure): ${config.secure ? "sim" : "nao"}`,
      "",
      `Emitido em: ${new Date().toLocaleString("pt-PT")}`
    ].join("\n");

    try {
      await transporter.sendMail({
        from: `"${config.fromName}" <${config.fromEmail}>`,
        to: target,
        subject,
        text,
        html: `<div style="font-family: Arial, Helvetica, sans-serif; color: #1b2742;">
          <h2 style="color: #0c4da2;">Teste de SMTP</h2>
          <p>Este e-mail confirma que o servidor SMTP foi configurado com sucesso no Kwanza Folha.</p>
          <ul>
            <li><strong>Servidor:</strong> ${config.host}:${config.port}</li>
            <li><strong>Secure:</strong> ${config.secure ? "sim" : "nao"}</li>
          </ul>
          <p style="color: #64748b; font-size: 12px;">Emitido em ${new Date().toLocaleString("pt-PT")}.</p>
        </div>`
      });

      return { ok: true, message: `E-mail de teste enviado para ${target}.` };
    } catch (error) {
      return {
        ok: false,
        message: `Falha ao enviar e-mail de teste: ${error.message || "erro desconhecido"}.`
      };
    }
  }
}

module.exports = {
  MailerService
};
