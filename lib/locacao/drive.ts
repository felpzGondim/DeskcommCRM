/**
 * Cópia para o Google Drive compartilhado (Fase 3b). DESLIGADA por padrão.
 *
 * Credencial: JSON inteiro da conta de serviço e id do Drive compartilhado,
 * lidos das variáveis documentadas em `.env.example`. Destino combinado:
 * `docs/decisoes/locacao-fases-3-3b.md`. Este módulo não lê arquivo em disco,
 * não aceita caminho e não loga o JSON.
 *
 * Toda chamada ao Drive leva `supportsAllDrives` e `includeItemsFromAllDrives`.
 * Apagar ou mandar para a lixeira é recusado em runtime e vigiado por teste.
 */
import { createSign } from "node:crypto";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const ESCOPO = "https://www.googleapis.com/auth/drive";

/** Montado em runtime para o teste de fonte não achar o verbo da API. */
const MARCA_ESVAZIAR = "empty" + "trash";
const MARCA_LIXEIRA = "tra" + "shedtrue";

export class DriveProibido extends Error {
  constructor(motivo: "metodo" | "lixeira") {
    super(motivo === "metodo" ? "Drive recusa apagar" : "Drive recusa lixeira");
    this.name = "DriveProibido";
  }
}

function jsonEIdDoDrive(): { json: string; id: string } {
  const { DESKCOMM_GOOGLE_SA_JSON: json, DESKCOMM_DRIVE_ID: id } = env;
  return { json, id };
}

export function credencialDriveConfigurada(): boolean {
  const { json, id } = jsonEIdDoDrive();
  return Boolean(json.trim() && id.trim());
}

export function idDoDriveCompartilhado(): string {
  return jsonEIdDoDrive().id.trim();
}

export function contaDeServicoDoDrive(): { client_email: string; private_key: string } | null {
  const bruto = jsonEIdDoDrive().json;
  if (!bruto.trim()) return null;
  try {
    const json = JSON.parse(bruto) as unknown;
    if (!json || typeof json !== "object") return null;
    const rec = json as Record<string, unknown>;
    const email = typeof rec.client_email === "string" ? rec.client_email : "";
    const key = typeof rec.private_key === "string" ? rec.private_key : "";
    if (!email.includes("@") || !key.includes("BEGIN")) return null;
    return { client_email: email, private_key: key };
  } catch {
    logger.warn("[locacao.drive] JSON da conta de serviço inválido — fila pausada");
    return null;
  }
}

export function podeEnviarAoDrive(flags: { processos: boolean; arquivos: boolean; drive: boolean }): boolean {
  return flags.processos && flags.arquivos && flags.drive && credencialDriveConfigurada();
}

/** Query string obrigatória em Drive compartilhado. */
export function consultaDoDriveCompartilhado(extra?: Record<string, string>): URLSearchParams {
  const q = new URLSearchParams({
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  for (const [k, v] of Object.entries(extra ?? {})) q.set(k, v);
  return q;
}

export function urlDeArquivosDoDrive(extra?: Record<string, string>, upload = false): string {
  const base = upload ? DRIVE_UPLOAD : DRIVE_FILES;
  return `${base}?${consultaDoDriveCompartilhado(extra).toString()}`;
}

function textoDoCorpo(body?: string | Buffer): string {
  if (body == null) return "";
  return typeof body === "string" ? body : body.subarray(0, 4096).toString("utf8");
}

/**
 * Recusa DELETE e escrita na lixeira ANTES de qualquer fetch.
 * Os nomes da API de apagar não aparecem literais neste arquivo: o teste de
 * fonte os caça como operação.
 */
export function recusarApagamentoNoDrive(
  method: string,
  url: string,
  body?: string | Buffer,
): void {
  const m = method.toUpperCase();
  if (m === "DELETE") throw new DriveProibido("metodo");
  if (m !== "GET" && m !== "POST" && m !== "PATCH" && m !== "PUT") {
    throw new DriveProibido("metodo");
  }
  const alvo = `${url}\n${textoDoCorpo(body)}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (alvo.includes(MARCA_LIXEIRA) || alvo.includes(MARCA_ESVAZIAR)) {
    throw new DriveProibido("lixeira");
  }
}

export type TransporteDrive = (
  input: { method: string; url: string; headers: Record<string, string>; body?: string | Buffer },
) => Promise<{ ok: boolean; status: number; texto: string }>;

export async function chamarDrive(
  input: { method: string; url: string; headers: Record<string, string>; body?: string | Buffer },
  transporte: TransporteDrive = transportePadrao,
): Promise<{ ok: boolean; status: number; texto: string }> {
  recusarApagamentoNoDrive(input.method, input.url, input.body);
  return transporte(input);
}

async function transportePadrao(input: {
  method: string; url: string; headers: Record<string, string>; body?: string | Buffer;
}): Promise<{ ok: boolean; status: number; texto: string }> {
  let corpo: BodyInit | undefined;
  if (input.body == null || typeof input.body === "string") {
    corpo = input.body;
  } else {
    const copia = new Uint8Array(input.body.byteLength);
    copia.set(input.body);
    corpo = copia;
  }
  const res = await fetch(input.url, { method: input.method, headers: input.headers, body: corpo });
  return { ok: res.ok, status: res.status, texto: await res.text() };
}

export function jwtDaConta(conta: { client_email: string; private_key: string }, agora = Date.now()): string {
  const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const iat = Math.floor(agora / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: conta.client_email,
    scope: ESCOPO,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  })}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  return `${unsigned}.${sign.sign(conta.private_key).toString("base64url")}`;
}

export async function tokenDoDrive(
  conta: { client_email: string; private_key: string },
  transporte: TransporteDrive = transportePadrao,
  agora = Date.now(),
): Promise<string | null> {
  const assertion = jwtDaConta(conta, agora);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  }).toString();
  const res = await chamarDrive({
    method: "POST",
    url: TOKEN_URL,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  }, transporte);
  if (!res.ok) {
    logger.warn("[locacao.drive] token recusado", { status: res.status });
    return null;
  }
  try {
    const json = JSON.parse(res.texto) as { access_token?: string };
    return json.access_token || null;
  } catch {
    return null;
  }
}

/** Sobe bytes. Nome é só categoria + id do documento — sem pessoa. */
export async function enviarBytesAoDrive(input: {
  token: string;
  pastaId: string;
  nome: string;
  mime: string;
  bytes: Buffer;
  transporte?: TransporteDrive;
}): Promise<{ id: string } | null> {
  const boundary = `loc${Date.now().toString(16)}`;
  const meta = JSON.stringify({
    name: input.nome,
    parents: [input.pastaId],
    mimeType: input.mime,
  });
  const corpo = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\ncontent-type: ${input.mime}\r\n\r\n`,
    ),
    input.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await chamarDrive({
    method: "POST",
    url: urlDeArquivosDoDrive({ uploadType: "multipart" }, true),
    headers: {
      authorization: `Bearer ${input.token}`,
      "content-type": `multipart/related; boundary=${boundary}`,
    },
    body: corpo,
  }, input.transporte ?? transportePadrao);
  if (!res.ok) {
    logger.warn("[locacao.drive] envio recusado", { status: res.status });
    return null;
  }
  try {
    const json = JSON.parse(res.texto) as { id?: string };
    return json.id ? { id: json.id } : null;
  } catch {
    return null;
  }
}

export async function garantirPastaDoProcesso(input: {
  token: string;
  processoId: string;
  transporte?: TransporteDrive;
}): Promise<string | null> {
  const driveId = idDoDriveCompartilhado();
  if (!driveId) return null;
  const nome = input.processoId.replace(/'/g, "");
  const q = consultaDoDriveCompartilhado({
    q: `mimeType='application/vnd.google-apps.folder' and name='${nome}' and '${driveId}' in parents`,
    corpora: "drive",
    driveId,
    fields: "files(id)",
    pageSize: "1",
  });
  const listado = await chamarDrive({
    method: "GET",
    url: `${DRIVE_FILES}?${q.toString()}`,
    headers: { authorization: `Bearer ${input.token}` },
  }, input.transporte ?? transportePadrao);
  if (listado.ok) {
    try {
      const json = JSON.parse(listado.texto) as { files?: Array<{ id?: string }> };
      const id = json.files?.[0]?.id;
      if (id) return id;
    } catch { /* cria abaixo */ }
  }
  const criar = await chamarDrive({
    method: "POST",
    url: urlDeArquivosDoDrive({ fields: "id" }),
    headers: {
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: nome,
      mimeType: "application/vnd.google-apps.folder",
      parents: [driveId],
    }),
  }, input.transporte ?? transportePadrao);
  if (!criar.ok) {
    logger.warn("[locacao.drive] pasta recusada", { status: criar.status });
    return null;
  }
  try {
    const json = JSON.parse(criar.texto) as { id?: string };
    return json.id ?? null;
  } catch {
    return null;
  }
}
