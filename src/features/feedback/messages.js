export function getFeedbackTone(message) {
  const text = String(message || "").toLowerCase();
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
    text.includes("disponível") ||
    text.includes("fechado") ||
    text.includes("reaberto")
  ) {
    return "warning";
  }
  if (
    text.includes("não foi possível") ||
    text.includes("invál") ||
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

  const normalized = message.toLowerCase();
  if (normalized.includes("permiss")) {
    return `${actionLabel}: a sua conta não tem permissão para executar esta ação.`;
  }
  if (normalized.includes("fechado")) {
    return `${actionLabel}: o período em causa está fechado. Reabra-o primeiro ou escolha outro mês.`;
  }
  if (
    normalized.includes("iban") ||
    normalized.includes("nif") ||
    normalized.includes("bi") ||
    normalized.includes("invál") ||
    normalized.includes("inval")
  ) {
    return `${actionLabel}: existem dados por corrigir. ${message}`;
  }
  if (normalized.includes("não existem") || normalized.includes("sem ")) {
    return `${actionLabel}: ${message}`;
  }
  return `${actionLabel}: ${message}`;
}
