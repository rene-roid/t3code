import { EnvironmentId, ORCHESTRATION_PROTOCOL_VERSION } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { remoteHttpClientLayer } from "../rpc/http.ts";
import { probeEnvironmentRoute } from "./routeProbe.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

const descriptor = (environmentId: string) =>
  Response.json({
    environmentId,
    label: "Probed environment",
    platform: { os: "linux", arch: "x64" },
    serverVersion: "0.0.0-test",
    orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
    capabilities: { repositoryIdentity: true },
  });

const httpLayer = remoteHttpClientLayer(((input) => {
  const url = new URL(String(input));
  expect(url.pathname).toBe("/.well-known/t3/environment");
  if (url.hostname === "other.example.test") return Promise.resolve(descriptor("environment-2"));
  if (url.hostname === "down.example.test") return Promise.reject(new TypeError("Failed to fetch"));
  return Promise.resolve(descriptor(ENVIRONMENT_ID));
}) satisfies typeof fetch);

describe("probeEnvironmentRoute", () => {
  it.effect("classifies a route by the descriptor it answers with", () =>
    Effect.gen(function* () {
      const probe = (httpBaseUrl: string) =>
        probeEnvironmentRoute({ httpBaseUrl, expectedEnvironmentId: ENVIRONMENT_ID }).pipe(
          Effect.provide(httpLayer),
        );

      expect(yield* probe("https://ok.example.test")).toMatchObject({ status: "reachable" });
      expect(yield* probe("https://other.example.test")).toEqual({
        status: "mismatch",
        environmentId: "environment-2",
      });
      expect(yield* probe("https://down.example.test")).toEqual({
        status: "unreachable",
        detail: "No response",
      });
      expect(yield* probe("192.168.1.5:3773")).toMatchObject({ status: "invalid" });
    }),
  );
});
