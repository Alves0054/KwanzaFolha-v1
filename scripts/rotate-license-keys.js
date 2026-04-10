const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rootDir = path.resolve(__dirname, "..");
const privateKeyPath = path.join(rootDir, "licensing-server", "storage", "keys", "license-private.pem");
const legacyPrivateKeyPath = path.join(rootDir, "licensing-server", "config", "license-private.pem");
const publicKeyPath = path.join(rootDir, "electron", "config", "license-public.pem");

fs.mkdirSync(path.dirname(privateKeyPath), { recursive: true });
fs.mkdirSync(path.dirname(publicKeyPath), { recursive: true });

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 4096,
  publicKeyEncoding: {
    type: "spki",
    format: "pem"
  },
  privateKeyEncoding: {
    type: "pkcs8",
    format: "pem"
  }
});

fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
fs.writeFileSync(publicKeyPath, publicKey, "utf8");

if (fs.existsSync(legacyPrivateKeyPath)) {
  fs.rmSync(legacyPrivateKeyPath, { force: true });
}

console.log("Nova chave privada gerada em:");
console.log(privateKeyPath);
console.log("");
console.log("Chave pública atualizada em:");
console.log(publicKeyPath);
console.log("");
console.log("Defina KWANZA_LICENSE_PRIVATE_KEY_PATH para o ficheiro privado no servidor de produção.");
