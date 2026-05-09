const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const {
  UPDATE_SOURCE,
  isConfigured,
  getGithubLatestApiUrl,
  getGithubLatestReleaseUrl
} = require("../config/update-source");

function normalizeVersion(version) {
  return String(version || "")
    .trim()
    .replace(/^v/i, "");
}

function extractSemanticVersion(versionLike) {
  const text = String(versionLike || "").trim();
  if (!text) return "";

  const match = text.match(/v?(\d+(?:\.\d+){1,3})/i);
  return match ? normalizeVersion(match[1]) : normalizeVersion(text);
}

function compareVersions(left, right) {
  const leftParts = normalizeVersion(left).split(".").map((part) => Number(part || 0));
  const rightParts = normalizeVersion(right).split(".").map((part) => Number(part || 0));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

function resolveReleaseVersion(release) {
  const tagVersion = extractSemanticVersion(release?.tag_name || "");
  const nameVersion = extractSemanticVersion(release?.name || "");

  if (tagVersion && /^\d+(?:\.\d+){1,3}$/.test(tagVersion)) return tagVersion;
  if (nameVersion && /^\d+(?:\.\d+){1,3}$/.test(nameVersion)) return nameVersion;
  return tagVersion || nameVersion;
}

function requestBuffer(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "Kwanza-Folha-Updater",
          ...headers
        }
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          requestBuffer(response.headers.location, headers).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`GitHub respondeu com o estado ${response.statusCode}.`));
          return;
        }

        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks)));
      }
    );

    request.on("error", reject);
  });
}

async function requestJson(url) {
  const buffer = await requestBuffer(url, {
    Accept: "application/vnd.github+json"
  });

  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw new Error("Não foi possível interpretar a resposta do GitHub.");
  }
}

async function requestText(url) {
  const buffer = await requestBuffer(url, {
    Accept: "text/plain,application/octet-stream"
  });
  return buffer.toString("utf8");
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: "application/octet-stream",
          "User-Agent": "Kwanza-Folha-Updater"
        }
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          downloadFile(response.headers.location, destination).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Não foi possível descarregar a atualização. Estado ${response.statusCode}.`));
          return;
        }

        const fileStream = fs.createWriteStream(destination);
        response.pipe(fileStream);
        fileStream.on("finish", () => {
          fileStream.close(() => resolve(destination));
        });
        fileStream.on("error", (error) => {
          fileStream.close(() => {
            if (fs.existsSync(destination)) {
              fs.unlinkSync(destination);
            }
            reject(error);
          });
        });
      }
    );

    request.on("error", (error) => {
      if (fs.existsSync(destination)) {
        fs.unlinkSync(destination);
      }
      reject(error);
    });
  });
}

function normalizeSha256(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : "";
}

function selectChecksumAsset(assets = [], checksumHint = "sha256") {
  const normalizedHint = String(checksumHint || "sha256").trim().toLowerCase();
  const nonExecutables = assets.filter((asset) => !String(asset.name || "").toLowerCase().endsWith(".exe"));

  return (
    nonExecutables.find((asset) => String(asset.name || "").toLowerCase().includes(normalizedHint)) ||
    nonExecutables.find((asset) => /\.sha256(?:\.txt)?$/i.test(String(asset.name || ""))) ||
    nonExecutables.find((asset) => /checksums/i.test(String(asset.name || ""))) ||
    null
  );
}

function parseChecksumManifest(content, assetName) {
  const expectedAssetName = String(assetName || "").trim();
  if (!content || !expectedAssetName) {
    return "";
  }

  const targetName = expectedAssetName.toLowerCase();
  const lines = String(content).split(/\r?\n/);

  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line) {
      continue;
    }

    let match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match) {
      const candidateName = path.basename(String(match[2] || "").trim()).toLowerCase();
      if (candidateName === targetName) {
        return normalizeSha256(match[1]);
      }
    }

    match = line.match(/^SHA256\s*\((.+?)\)\s*=\s*([a-fA-F0-9]{64})$/i);
    if (match) {
      const candidateName = path.basename(String(match[1] || "").trim()).toLowerCase();
      if (candidateName === targetName) {
        return normalizeSha256(match[2]);
      }
    }

    match = line.match(/^(.+?)\s*[:=]\s*([a-fA-F0-9]{64})$/);
    if (match) {
      const candidateName = path.basename(String(match[1] || "").trim()).toLowerCase();
      if (candidateName === targetName) {
        return normalizeSha256(match[2]);
      }
    }
  }

  return "";
}

function computeFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

class UpdaterService {
  constructor({ app, shell, workspaceDir, currentVersion, productName }) {
    this.app = app;
    this.shell = shell;
    this.workspaceDir = workspaceDir;
    this.currentVersion = currentVersion;
    this.productName = productName;
    this.downloadedUpdate = null;
  }

  resolveConfig() {
    return {
      owner: String(UPDATE_SOURCE.owner || "").trim(),
      repo: String(UPDATE_SOURCE.repo || "").trim(),
      assetHint: String(UPDATE_SOURCE.assetHint || "setup").trim(),
      checksumHint: String(UPDATE_SOURCE.checksumHint || "sha256").trim(),
      prerelease: Boolean(UPDATE_SOURCE.allowPrerelease)
    };
  }

  validateConfig(config) {
    if (!isConfigured() || !config.owner || !config.repo) {
      return {
        ok: false,
        message: `Configure o GitHub em electron/config/update-source.js antes de usar as atualizacoes automaticas. Ligacao base: ${getGithubLatestReleaseUrl()}`
      };
    }

    return { ok: true };
  }

  async fetchLatestRelease(config) {
    const validation = this.validateConfig(config);
    if (!validation.ok) {
      return validation;
    }

    const latest = await requestJson(getGithubLatestApiUrl());
    if (!config.prerelease && latest.prerelease) {
      return {
        ok: false,
        message: "A ultima release do GitHub esta marcada como pre-lancamento."
      };
    }

    const assets = Array.isArray(latest.assets) ? latest.assets : [];
    const hint = String(config.assetHint || "setup").toLowerCase();
    const windowsAssets = assets.filter((asset) => String(asset.name || "").toLowerCase().endsWith(".exe"));
    const preferredAsset =
      windowsAssets.find((asset) => String(asset.name || "").toLowerCase().includes(hint)) ||
      windowsAssets.find((asset) => !String(asset.name || "").toLowerCase().includes("portable")) ||
      windowsAssets[0] ||
      null;
    const checksumAsset = selectChecksumAsset(assets, config.checksumHint);

    return {
      ok: true,
      release: latest,
      asset: preferredAsset,
      checksumAsset
    };
  }

  async fetchChecksumManifest(url) {
    return requestText(url);
  }

  async downloadReleaseAsset(url, destination) {
    return downloadFile(url, destination);
  }

  async verifyDownloadedUpdateIntegrity(downloadedUpdate = this.downloadedUpdate) {
    if (!downloadedUpdate || !downloadedUpdate.path || !fs.existsSync(downloadedUpdate.path)) {
      return { ok: false, message: "Ainda não existe nenhuma atualização descarregada." };
    }

    const expectedSha256 = normalizeSha256(downloadedUpdate.sha256);
    if (!expectedSha256) {
      return { ok: false, message: "A atualização descarregada não inclui um hash SHA-256 validado." };
    }

    const actualSha256 = await computeFileSha256(downloadedUpdate.path);
    if (actualSha256 !== expectedSha256) {
      return {
        ok: false,
        message: "A verificacao SHA-256 do instalador falhou. A atualizacao foi bloqueada.",
        expectedSha256,
        actualSha256
      };
    }

    return { ok: true, expectedSha256, actualSha256 };
  }

  async checkForUpdates() {
    const config = this.resolveConfig();
    const latestResult = await this.fetchLatestRelease(config);
    if (!latestResult.ok) {
      return latestResult;
    }

    const latestVersion = resolveReleaseVersion(latestResult.release);
    const currentVersion = extractSemanticVersion(this.currentVersion);
    const available = latestVersion ? compareVersions(latestVersion, currentVersion) === 1 : false;
    const missingInstallerMessage = latestResult.asset
      ? ""
      : "A release foi encontrada, mas ainda não tem um instalador .exe anexado.";
    const missingChecksumMessage = latestResult.asset && !latestResult.checksumAsset
      ? "A release foi encontrada, mas ainda não publica um manifesto SHA-256 do instalador."
      : "";

    return {
      ok: true,
      available,
      currentVersion,
      latestVersion,
      releaseName: latestResult.release.name || latestResult.release.tag_name || latestVersion,
      publishedAt: latestResult.release.published_at || "",
      releaseNotes: String(latestResult.release.body || "").trim(),
      downloadUrl: latestResult.asset?.browser_download_url || "",
      assetName: latestResult.asset?.name || "",
      checksumUrl: latestResult.checksumAsset?.browser_download_url || "",
      checksumAssetName: latestResult.checksumAsset?.name || "",
      htmlUrl: latestResult.release.html_url || "",
      releasePageUrl: getGithubLatestReleaseUrl(),
      message: missingInstallerMessage || missingChecksumMessage,
      alreadyDownloaded:
        Boolean(this.downloadedUpdate) &&
        this.downloadedUpdate.version === latestVersion &&
        fs.existsSync(this.downloadedUpdate.path)
    };
  }

  async downloadUpdate() {
    const releaseResult = await this.checkForUpdates();
    if (!releaseResult.ok) {
      return releaseResult;
    }

    if (!releaseResult.available) {
      return {
        ok: true,
        available: false,
        message: "Esta versão já se encontra atualizada.",
        currentVersion: releaseResult.currentVersion,
        latestVersion: releaseResult.latestVersion
      };
    }

    if (!releaseResult.downloadUrl || !releaseResult.assetName) {
      return {
        ok: false,
        message: "A release foi encontrada, mas ainda não tem um instalador .exe compatível anexado."
      };
    }

    if (!releaseResult.checksumUrl || !releaseResult.checksumAssetName) {
      return {
        ok: false,
        message: "A release foi encontrada, mas ainda não publica um manifesto SHA-256 do instalador."
      };
    }

    const checksumManifest = await this.fetchChecksumManifest(releaseResult.checksumUrl);
    const expectedSha256 = parseChecksumManifest(checksumManifest, releaseResult.assetName);
    if (!expectedSha256) {
      return {
        ok: false,
        message: "Não foi possível validar o manifesto SHA-256 da release."
      };
    }

    const updatesDir = path.join(this.workspaceDir, "Atualizacoes");
    fs.mkdirSync(updatesDir, { recursive: true });
    const targetPath = path.join(updatesDir, releaseResult.assetName);
    await this.downloadReleaseAsset(releaseResult.downloadUrl, targetPath);

    const integrity = await this.verifyDownloadedUpdateIntegrity({
      path: targetPath,
      sha256: expectedSha256
    });
    if (!integrity.ok) {
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      return integrity;
    }

    this.downloadedUpdate = {
      version: releaseResult.latestVersion,
      path: targetPath,
      releaseName: releaseResult.releaseName,
      sha256: expectedSha256,
      checksumAssetName: releaseResult.checksumAssetName
    };

    return {
      ok: true,
      available: true,
      downloaded: true,
      currentVersion: releaseResult.currentVersion,
      latestVersion: releaseResult.latestVersion,
      releaseName: releaseResult.releaseName,
      path: targetPath,
      integrityVerified: true
    };
  }

  installDownloadedUpdate() {
    if (!this.downloadedUpdate || !fs.existsSync(this.downloadedUpdate.path)) {
      return {
        ok: false,
        message: "Ainda não existe nenhuma atualização descarregada."
      };
    }

    return this.verifyDownloadedUpdateIntegrity().then((integrity) => {
      if (!integrity.ok) {
        return integrity;
      }

      const openResult = this.shell.openPath(this.downloadedUpdate.path);
      if (openResult && typeof openResult.then === "function") {
        return openResult.then((errorMessage) => {
          if (errorMessage) {
            return { ok: false, message: errorMessage };
          }

          setTimeout(() => this.app.quit(), 1200);
          return { ok: true, path: this.downloadedUpdate.path };
        });
      }

      return { ok: false, message: "Não foi possível abrir o instalador descarregado." };
    });
  }
}

module.exports = {
  UpdaterService,
  extractSemanticVersion,
  parseChecksumManifest,
  resolveReleaseVersion
};
