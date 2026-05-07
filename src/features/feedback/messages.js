function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function getFeedbackTone(message) {
  const text = normalizeText(message);
  if (!text) return "info";
  if (
    text.includes("sucesso") ||
    text.includes("conclu") ||
    text.includes("gerado") ||
    text.includes("guardado") ||
    text.includes("enviad") ||
    text.includes("exportad") ||
    text.includes("atualizada") ||
    text.includes("criada")
  ) {
    return "success";
  }
  if (
    text.includes("altere a palavra-passe") ||
    text.includes("disponivel") ||
    text.includes("fechado") ||
    text.includes("reaberto")
  ) {
    return "warning";
  }
  if (
    text.includes("nao foi possivel") ||
    text.includes("inval") ||
    text.includes("erro") ||
    text.includes("falha") ||
    text.includes("bloque")
  ) {
    return "error";
  }
  return "info";
}

export function contextualizeFeedback(actionLabel, resultMessage, fallbackMessage) {
  const message = String(resultMessage || "").trim();
  if (!message) return fallbackMessage;

  const normalized = normalizeText(message);
  if (normalized.includes("permiss")) {
    return `${actionLabel}: a sua conta não tem permissão para executar esta ação.`;
  }
  if (normalized.includes("fechado")) {
    return `${actionLabel}: o período em causa está fechado. Reabra-o primeiro ou escolha outro mês.`;
  }
  if (
    normalized.includes("assinatura digital") ||
    normalized.includes("license_signature_mismatch") ||
    normalized.includes("token de licenca") ||
    normalized.includes("token de licen")
  ) {
    return `${actionLabel}: a licença foi encontrada, mas a assinatura digital não corresponde a esta versão do aplicativo. Atualize o servidor de licenças com a chave privada correta ou instale a build correspondente ao servidor.`;
  }
  if (
    normalized.includes("iban") ||
    normalized.includes("nif") ||
    normalized.includes("bi") ||
    normalized.includes("inval")
  ) {
    return `${actionLabel}: existem dados por corrigir. ${message}`;
  }
  if (normalized.includes("nao existem") || normalized.includes("sem ")) {
    return `${actionLabel}: ${message}`;
  }
  return `${actionLabel}: ${message}`;
}
