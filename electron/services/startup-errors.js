function getErrorMessage(error) {
  return String(error?.message || error || "");
}

function isNativeSqliteAbiError(error) {
  const rawMessage = getErrorMessage(error);
  return /NODE_MODULE_VERSION|compiled against a different Node\.js version|was compiled against a different Node\.js version/i.test(rawMessage);
}

function resolveStartupFailureMessage(error) {
  const rawMessage = getErrorMessage(error);

  if (isNativeSqliteAbiError(error) || /better-sqlite3/i.test(rawMessage)) {
    return "Falha de compatibilidade dos módulos SQLite. Reinstale a aplicação com uma build gerada para a versão correta do Electron.";
  }

  if (/Unsupported state or unable to authenticate data|failed to decrypt database|decrypt/i.test(rawMessage)) {
    return "Não foi possível abrir a base de dados cifrada. Valide a chave local e os ficheiros de dados.";
  }

  if (/file is not a database|database disk image is malformed/i.test(rawMessage)) {
    return "A base de dados local estava inválida e o sistema tentou recuperar automaticamente. Reinicie a aplicacao e valide os dados recentes.";
  }

  if (/cannot open|unable to open|readonly database|disk i\/o error|sqlcipher|sqlite/i.test(rawMessage)) {
    return "Não foi possível abrir a base de dados local. O sistema tentou recuperação automática; reinicie e valide os dados recentes.";
  }

  if (/license|licenca|licensing/i.test(rawMessage)) {
    return "Não foi possível inicializar o serviço de licenciamento. O sistema abriu em modo restrito para evitar falhas totais.";
  }

  if (/ipc|handler/i.test(rawMessage)) {
    return "Falha ao registar canais internos (IPC). Reinicie a aplicação e valide os módulos do sistema.";
  }

  return "Erro de integridade da instalacao. Contacte o suporte para reativação.";
}

function isRecoverableDatabaseStartupError(error) {
  if (isNativeSqliteAbiError(error)) {
    return false;
  }

  const rawMessage = getErrorMessage(error).toLowerCase();
  return (
    rawMessage.includes("file is not a database") ||
    rawMessage.includes("database disk image is malformed") ||
    rawMessage.includes("failed to decrypt database") ||
    rawMessage.includes("unsupported state or unable to authenticate data")
  );
}

function isDatabaseStartupError(error) {
  if (isNativeSqliteAbiError(error)) {
    return false;
  }

  const rawMessage = getErrorMessage(error).toLowerCase();
  return (
    isRecoverableDatabaseStartupError(error) ||
    rawMessage.includes("sqlite") ||
    rawMessage.includes("database") ||
    rawMessage.includes("sqlcipher") ||
    rawMessage.includes("cannot open") ||
    rawMessage.includes("unable to open")
  );
}

module.exports = {
  isDatabaseStartupError,
  isNativeSqliteAbiError,
  isRecoverableDatabaseStartupError,
  resolveStartupFailureMessage
};
