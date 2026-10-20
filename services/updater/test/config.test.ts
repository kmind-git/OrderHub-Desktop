import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("updater configuration", () => {
  it("allows a non-loopback HTTP artifact base only with the explicit opt-in", () => {
    expect(() =>
      loadConfig({
        ORDERHUB_UPDATER_PUBLIC_BASE_URL: "http://8.159.158.144:8787/artifacts",
      }),
    ).toThrow(/ALLOW_INSECURE_ARTIFACT_URL/);

    const config = loadConfig({
      ORDERHUB_UPDATER_HOST: "0.0.0.0",
      ORDERHUB_UPDATER_PUBLIC_BASE_URL: "http://8.159.158.144:8787/artifacts",
      ORDERHUB_UPDATER_ALLOW_INSECURE_ARTIFACT_URL: "1",
    });
    expect(config.host).toBe("0.0.0.0");
    expect(config.publicArtifactBaseUrl).toBe("http://8.159.158.144:8787/artifacts");
    expect(config.allowInsecureArtifactUrl).toBe(true);
  });
});
