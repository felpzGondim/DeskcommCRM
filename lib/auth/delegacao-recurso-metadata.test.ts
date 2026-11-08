import { describe, expect, it } from "vitest";

import {
  CAMINHO_METADATA_RECURSO_DELEGADO,
  CAMINHO_SUPERFICIE_DELEGADA,
  montarDocumentoRecursoDelegado,
  origemHttp,
} from "./delegacao-recurso-metadata";

describe("montarDocumentoRecursoDelegado", () => {
  it("recurso é a superfície isolada; AS é a origem do Auth, não um AS inventado", () => {
    const doc = montarDocumentoRecursoDelegado({
      origemDoApp: "https://crm.example.test",
      origemDoAuth: "https://auth.example.test",
    });
    expect(doc).toEqual({
      resource: "https://crm.example.test/api/mcp/delegacao",
      authorization_servers: ["https://auth.example.test"],
      bearer_methods_supported: ["header"],
    });
    expect(CAMINHO_SUPERFICIE_DELEGADA).toBe("/api/mcp/delegacao");
    expect(CAMINHO_METADATA_RECURSO_DELEGADO).toBe(
      "/.well-known/oauth-protected-resource/api/mcp/delegacao",
    );
  });

  it("origem inválida não inventa documento", () => {
    expect(
      montarDocumentoRecursoDelegado({
        origemDoApp: "not-a-url",
        origemDoAuth: "https://auth.example.test",
      }),
    ).toBeNull();
    expect(origemHttp("ftp://x")).toBeNull();
  });
});
