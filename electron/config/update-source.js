const UPDATE_SOURCE = {
  owner: "Alves0054",
  repo: "KwanzaFolha-v1",
  assetHint: "setup",
  checksumHint: "sha256",
  allowPrerelease: false
};

function isConfigured() {
  return (
    UPDATE_SOURCE.owner &&
    UPDATE_SOURCE.repo &&
    UPDATE_SOURCE.owner !== "SEU_UTILIZADOR_GITHUB" &&
    UPDATE_SOURCE.repo !== "SEU_REPOSITORIO_GITHUB"
  );
}

function getGithubLatestApiUrl() {
  return `https://api.github.com/repos/${UPDATE_SOURCE.owner}/${UPDATE_SOURCE.repo}/releases/latest`;
}

function getGithubLatestReleaseUrl() {
  return `https://github.com/${UPDATE_SOURCE.owner}/${UPDATE_SOURCE.repo}/releases/latest`;
}

module.exports = {
  UPDATE_SOURCE,
  isConfigured,
  getGithubLatestApiUrl,
  getGithubLatestReleaseUrl
};
