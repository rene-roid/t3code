import type { EnvironmentId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { RemoteEnvironmentRequestError } from "../rpc/http.ts";
import { fetchRemoteEnvironmentDescriptor } from "./descriptor.ts";
import { normalizeHttpBaseUrl } from "./endpoint.ts";

export type RouteProbeResult =
  | { readonly status: "reachable"; readonly latencyMs: number }
  | { readonly status: "unreachable"; readonly detail: string }
  | { readonly status: "mismatch"; readonly environmentId: string }
  | { readonly status: "invalid"; readonly detail: string };

const ROUTE_PROBE_TIMEOUT_MS = 5_000;

/**
 * Checks from this device whether an address reaches the expected environment,
 * for live feedback while a user edits a saved route. It fetches the same public
 * descriptor the resolver races, so a reachable result here means the route can
 * win at connect time. Never fails: every outcome is a result the UI can show.
 */
export const probeEnvironmentRoute = Effect.fn("clientRuntime.environment.probeEnvironmentRoute")(
  function* (input: {
    readonly httpBaseUrl: string;
    readonly expectedEnvironmentId: EnvironmentId;
  }) {
    let httpBaseUrl: string;
    try {
      httpBaseUrl = normalizeHttpBaseUrl(input.httpBaseUrl);
    } catch (cause) {
      return {
        status: "invalid",
        detail:
          cause instanceof Error && !cause.message.startsWith("Invalid URL")
            ? cause.message
            : "Enter a full URL, including http:// or https://.",
      } satisfies RouteProbeResult;
    }
    const startedAt = yield* Clock.currentTimeMillis;
    const outcome = yield* fetchRemoteEnvironmentDescriptor({
      httpBaseUrl,
      timeoutMs: ROUTE_PROBE_TIMEOUT_MS,
    }).pipe(Effect.result);
    if (Result.isFailure(outcome)) {
      return {
        status: "unreachable",
        detail: unreachableDetail(outcome.failure),
      } satisfies RouteProbeResult;
    }
    if (outcome.success.environmentId !== input.expectedEnvironmentId) {
      return {
        status: "mismatch",
        environmentId: outcome.success.environmentId,
      } satisfies RouteProbeResult;
    }
    const finishedAt = yield* Clock.currentTimeMillis;
    return { status: "reachable", latencyMs: finishedAt - startedAt } satisfies RouteProbeResult;
  },
);

/** Short, user-facing reason a route did not answer as a T3 Code server. */
function unreachableDetail(error: RemoteEnvironmentRequestError): string {
  switch (error._tag) {
    case "RemoteEnvironmentAuthTimeoutError":
      return "Timed out";
    case "RemoteEnvironmentAuthFetchError":
      return "No response";
    case "RemoteEnvironmentAuthInvalidJsonError":
      return "Not a T3 Code server";
    case "RemoteEnvironmentAuthUndeclaredStatusError":
      return `HTTP ${error.status}`;
    default:
      return error._tag.replace(/^Environment|Error$/gu, "");
  }
}

/** One-line status for a probe; null means a probe is still running. */
export function routeProbeLabel(result: RouteProbeResult | null): string {
  if (result === null) return "Checking…";
  switch (result.status) {
    case "reachable":
      return `Reachable · ${result.latencyMs} ms`;
    case "unreachable":
      return `Unreachable · ${result.detail}`;
    case "mismatch":
      return "Reaches a different machine";
    case "invalid":
      return result.detail;
  }
}
