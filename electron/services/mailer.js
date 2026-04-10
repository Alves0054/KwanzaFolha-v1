const nodemailer = require("nodemailer");

function isValidEmail(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(normalized);
}

class MailerService {
  constructor({ database, productName = "Kwanza Folha" }) {
    this.database = database;
    this.productName = productName;
  }

  getMailConfig() {
    const settings = this.database.getSystemSettings();
    const company = this.database.getCompanyProfile() || {};

    return {
      host: String(settings.smtpHost || "").trim(),
      port: Number(settings.smtpPort || 0) || 587,
      secure: Boolean(settings.smtpSecure),
      user: String(settings.smtpUser || "").trim(),
      password: String(settings.smtpPassword || "").trim(),
      fromName: String(settings.smtpFromName || company.name || this.productName).trim(),
      fromEmail: String(settings.smtpFromEmail || company.email || settings.smtpUser || "").trim(),
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

  async sendPasswordResetToken({ email, fullName, username, resetToken, expiresAt }) {
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

  async sendPasswordResetCredentials(payload) {
    return this.sendPasswordResetToken(payload);
  }
}

module.exports = {
  MailerService
};
