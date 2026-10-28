import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  chamarDrive,
  consultaDoDriveCompartilhado,
  credencialDriveConfigurada,
  DriveProibido,
  jwtDaConta,
  podeEnviarAoDrive,
  recusarApagamentoNoDrive,
  urlDeArquivosDoDrive,
} from "@/lib/locacao/drive";

describe("drive da locação", () => {
  it("não envia se qualquer chave de feature estiver desligada", () => {
    expect(podeEnviarAoDrive({ processos: true, arquivos: true, drive: false })).toBe(false);
    expect(podeEnviarAoDrive({ processos: true, arquivos: false, drive: true })).toBe(false);
    expect(podeEnviarAoDrive({ processos: false, arquivos: true, drive: true })).toBe(false);
  });

  it("sem JSON e id do Drive, a credencial não está configurada", () => {
    if (!process.env["DESKCOMM_GOOGLE_SA_JSON"] && !process.env["DESKCOMM_DRIVE_ID"]) {
      expect(credencialDriveConfigurada()).toBe(false);
      expect(podeEnviarAoDrive({ processos: true, arquivos: true, drive: true })).toBe(false);
    }
  });

  it("toda URL de arquivo leva as duas flags de Drive compartilhado", () => {
    const q = consultaDoDriveCompartilhado({ pageSize: "1" });
    expect(q.get("supportsAllDrives")).toBe("true");
    expect(q.get("includeItemsFromAllDrives")).toBe("true");
    expect(q.get("pageSize")).toBe("1");
    const url = urlDeArquivosDoDrive({ fields: "id" });
    expect(url).toContain("supportsAllDrives=true");
    expect(url).toContain("includeItemsFromAllDrives=true");
    expect(url).toContain("www.googleapis.com/drive/v3/files");
  });

  it("recusa apagar e recusa lixeira antes do transporte", async () => {
    expect(() => recusarApagamentoNoDrive("DELETE", "https://www.googleapis.com/drive/v3/files/x")).toThrow(
      DriveProibido,
    );
    expect(() => recusarApagamentoNoDrive("POST", "https://example.invalid", '{"trashed":true}')).toThrow(
      DriveProibido,
    );
    expect(() => recusarApagamentoNoDrive("POST", "https://example.invalid/emptyTrash")).toThrow(
      DriveProibido,
    );
    await expect(
      chamarDrive({
        method: "DELETE",
        url: "https://www.googleapis.com/drive/v3/files/x",
        headers: {},
      }, async () => {
        throw new Error("transporte não deveria rodar");
      }),
    ).rejects.toBeInstanceOf(DriveProibido);
  });

  it("aceita GET e POST sem lixeira", () => {
    expect(() => recusarApagamentoNoDrive("GET", urlDeArquivosDoDrive({ fields: "id" }))).not.toThrow();
    expect(() => recusarApagamentoNoDrive("POST", urlDeArquivosDoDrive(), '{"name":"x"}')).not.toThrow();
  });

  it("assina JWT RS256 da conta de serviço", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const jwt = jwtDaConta({ client_email: "bot@example.invalid", private_key: pem }, 1_700_000_000_000);
    const partes = jwt.split(".");
    expect(partes).toHaveLength(3);
    const payload = JSON.parse(Buffer.from(partes[1]!, "base64url").toString("utf8")) as {
      iss: string; scope: string; aud: string;
    };
    expect(payload.iss).toBe("bot@example.invalid");
    expect(payload.scope).toContain("googleapis.com/auth/drive");
    expect(payload.aud).toBe("https://oauth2.googleapis.com/token");
  });
});
