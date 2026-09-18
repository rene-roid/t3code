import { ConnectionTraceId } from "./ConnectionTraceId";
import { SymbolView } from "../../components/AppSymbol";
import { connectionStatusText } from "@t3tools/client-runtime/connection";
import { type RouteProbeResult, routeProbeLabel } from "@t3tools/client-runtime/environment";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { type EnvironmentId, resolveEnvironmentMachineKind } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Alert, Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

import { AppText as Text } from "../../components/AppText";
import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { MaterialButton } from "../../components/MaterialButton";
import { MaterialIconButton } from "../../components/MaterialIconButton";
import { ThemedSwitch } from "../../components/ThemedSwitch";
import { cn } from "../../lib/cn";
import type {
  ConnectedEnvironmentSummary,
  EnvironmentUpdateInput,
} from "../../state/remote-runtime-types";
import { environmentCatalog } from "../../connection/catalog";
import { probeRoute } from "../../connection/onboarding";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "../../state/server";
import { usePreparedConnection } from "../../state/session";
import { ConnectionFormField } from "./ConnectionFormField";
import { ConnectionStatusDot } from "./ConnectionStatusDot";

function connectionStatusLabel(environment: ConnectedEnvironmentSummary): string | null {
  if (!environment.isEnabled && environment.connectionState !== "unsupported") {
    return "Off";
  }
  return connectionStatusText({
    phase: environment.connectionState,
    error: environment.connectionError,
    traceId: environment.connectionErrorTraceId,
  });
}

const PROBE_DEBOUNCE_MS = 500;

// Row keys survive removal so a deleted row does not re-key the ones after it.
let nextRouteId = 0;
const newRoute = (url: string) => ({ id: nextRouteId++, url });

/** Probes an address from this device as the user types, debounced. */
function useRouteProbe(url: string, environmentId: EnvironmentId) {
  const probe = useAtomCommand(probeRoute, { reportFailure: false, reportDefect: false });
  // The result is tagged with the URL it answers for, so a stale answer for an
  // earlier value never shows against the current one.
  const [probed, setProbed] = useState<{ url: string; result: RouteProbeResult } | null>(null);
  useEffect(() => {
    if (url.trim() === "") return;
    let stale = false;
    const timer = setTimeout(() => {
      void probe({ httpBaseUrl: url, expectedEnvironmentId: environmentId }).then((outcome) => {
        if (!stale && outcome._tag === "Success") setProbed({ url, result: outcome.value });
      });
    }, PROBE_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [url, environmentId, probe]);
  return probed?.url === url ? probed.result : null;
}

function RouteField(props: {
  readonly url: string;
  readonly environmentId: EnvironmentId;
  readonly preferred: boolean;
  readonly removable: boolean;
  readonly onChange: (url: string) => void;
  readonly onRemove: () => void;
}) {
  const probe = useRouteProbe(props.url, props.environmentId);
  const empty = props.url.trim() === "";
  return (
    <View className="gap-1">
      <View className="flex-row items-end gap-2">
        <View className="flex-1">
          <ConnectionFormField
            label={props.preferred ? "Preferred URL" : "Other URL"}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://machine.tailnet.ts.net"
            value={props.url}
            onChangeText={props.onChange}
          />
        </View>
        {Platform.OS === "android" ? (
          <MaterialIconButton
            accessibilityLabel="Remove URL"
            icon="trash"
            variant="tonal"
            disabled={!props.removable}
            onPress={props.onRemove}
          />
        ) : (
          <Pressable
            accessibilityLabel="Remove URL"
            className="h-[42px] w-[42px] items-center justify-center rounded-[14px] border border-input-border bg-input active:opacity-70 disabled:opacity-40"
            disabled={!props.removable}
            onPress={props.onRemove}
          >
            <SymbolView
              name="trash"
              size={14}
              tintColorClassName="accent-icon-subtle"
              type="monochrome"
            />
          </Pressable>
        )}
      </View>
      {empty ? null : (
        <Text
          className={cn(
            "text-xs",
            probe?.status === "reachable"
              ? "text-foreground-muted"
              : probe === null
                ? "text-foreground-muted"
                : "text-danger-foreground",
          )}
        >
          {routeProbeLabel(probe)}
        </Text>
      )}
    </View>
  );
}

/** The saved routes of a pairing this device made itself; null for anything else. */
function useSavedRoutes(environmentId: EnvironmentId) {
  const entry = useAtomValue(environmentCatalog.catalogValueAtom).entries.get(environmentId);
  const profile = entry === undefined ? null : Option.getOrNull(entry.profile);
  return useMemo(
    () =>
      profile?._tag === "BearerConnectionProfile"
        ? {
            alternateHttpBaseUrls: profile.alternateHttpBaseUrls ?? [],
            pinnedRoute: profile.pinnedRoute === true,
          }
        : null,
    [profile],
  );
}

export function ConnectionEnvironmentRow(props: {
  readonly environment: ConnectedEnvironmentSummary;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onReconnect: (environmentId: EnvironmentId) => void;
  readonly onRemove: (environmentId: EnvironmentId) => void;
  readonly onSetEnabled: (environmentId: EnvironmentId, enabled: boolean) => void;
  readonly onUpdate: (
    environmentId: EnvironmentId,
    updates: EnvironmentUpdateInput,
  ) => Promise<AtomCommandResult<unknown, unknown>>;
}) {
  const [label, setLabel] = useState(props.environment.environmentLabel);
  const savedRoutes = useSavedRoutes(props.environment.environmentId);
  const [routes, setRoutes] = useState<ReadonlyArray<{ id: number; url: string }>>(() =>
    [props.environment.displayUrl, ...(savedRoutes?.alternateHttpBaseUrls ?? [])].map(newRoute),
  );
  const [pinnedRoute, setPinnedRoute] = useState(savedRoutes?.pinnedRoute ?? false);
  // A multi-route pairing may be connected over an alternate address; show
  // the one actually in use rather than the saved preferred one.
  const activeHttpBaseUrl = Option.getOrNull(
    usePreparedConnection(props.environment.environmentId),
  )?.httpBaseUrl;
  const serverConfig = useAtomValue(
    serverEnvironment.configValueAtom(props.environment.environmentId),
  );
  const unsupported = props.environment.connectionState === "unsupported";
  const enabled = props.environment.isEnabled && !unsupported;
  const statusLabel = connectionStatusLabel(props.environment);
  const statusTraceId = enabled ? props.environment.connectionErrorTraceId : null;
  // Unsupported is a compatibility note, not a failure, so it stays muted.
  const hasConnectionFailure = enabled && props.environment.connectionError !== null;
  const isRetrying =
    enabled &&
    (props.environment.connectionState === "connecting" ||
      props.environment.connectionState === "reconnecting");
  const handleSave = useCallback(async () => {
    const [displayUrl = "", ...alternateHttpBaseUrls] = routes
      .map((route) => route.url.trim())
      .filter((route) => route !== "");
    const result = await props.onUpdate(props.environment.environmentId, {
      label: label.trim(),
      displayUrl,
      ...(savedRoutes === null ? {} : { alternateHttpBaseUrls, pinnedRoute }),
    });
    if (AsyncResult.isSuccess(result)) {
      props.onToggle();
      return;
    }
    const error = Cause.squash(result.cause);
    Alert.alert(
      "Could not update environment",
      error instanceof Error ? error.message : "The environment could not be updated.",
    );
  }, [label, routes, pinnedRoute, savedRoutes, props]);

  return (
    <Animated.View layout={LinearTransition.duration(250)} className="bg-card">
      <Pressable
        className="flex-row items-center gap-3 px-4 py-3.5 active:opacity-70"
        onPress={props.onToggle}
      >
        <ConnectionStatusDot
          state={enabled || unsupported ? props.environment.connectionState : "available"}
          pulse={isRetrying}
          size={8}
        />

        <View className="flex-1 gap-0.5">
          <View className="flex-row items-center gap-1.5">
            <EnvironmentMachineSymbol
              kind={resolveEnvironmentMachineKind(serverConfig)}
              size={14}
              tintColorClassName="accent-foreground-muted"
            />
            <Text
              className="min-w-0 flex-shrink text-base font-t3-bold leading-snug text-foreground"
              numberOfLines={1}
            >
              {props.environment.environmentLabel}
            </Text>
          </View>
          <Text className="text-xs text-foreground-muted" numberOfLines={1}>
            {props.environment.connectionState === "connected" && activeHttpBaseUrl
              ? activeHttpBaseUrl
              : props.environment.displayUrl}
          </Text>
          {statusLabel ? (
            <Text
              className={cn(
                "text-xs",
                hasConnectionFailure ? "text-danger-foreground" : "text-foreground-muted",
              )}
              numberOfLines={props.expanded ? undefined : 1}
              selectable={props.expanded}
            >
              {statusLabel}
              {statusTraceId ? (
                <ConnectionTraceId
                  traceId={statusTraceId}
                  tone={hasConnectionFailure ? "danger" : "muted"}
                  activation="longPress"
                />
              ) : null}
            </Text>
          ) : null}
        </View>

        <ThemedSwitch
          disabled={unsupported}
          onValueChange={(next) => props.onSetEnabled(props.environment.environmentId, next)}
          value={enabled}
        />
        <SymbolView
          name="chevron.down"
          size={12}
          tintColorClassName="accent-icon-subtle"
          type="monochrome"
          style={{
            transform: [{ rotate: props.expanded ? "180deg" : "0deg" }],
          }}
        />
      </Pressable>

      {props.expanded ? (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(150)}
          className="gap-3 px-4 pb-4"
        >
          {props.environment.isRelayManaged ? (
            <Text className="text-sm text-foreground-muted">
              Managed by T3 Connect. Tunnel details update automatically.
            </Text>
          ) : (
            <>
              <ConnectionFormField
                label="Label"
                autoCapitalize="words"
                autoCorrect={false}
                placeholder="My MacBook"
                value={label}
                onChangeText={setLabel}
              />

              {routes.map((route, index) => (
                <RouteField
                  key={route.id}
                  url={route.url}
                  environmentId={props.environment.environmentId}
                  preferred={index === 0}
                  removable={routes.length > 1}
                  onChange={(url) => setRoutes(routes.with(index, { ...route, url }))}
                  onRemove={() => setRoutes(routes.filter((candidate) => candidate !== route))}
                />
              ))}
              {savedRoutes === null ? null : (
                <>
                  {Platform.OS === "android" ? (
                    <MaterialButton
                      label="Add URL"
                      tone="secondary"
                      onPress={() => setRoutes([...routes, newRoute("")])}
                    />
                  ) : (
                    <Pressable
                      className="min-h-[42px] flex-row items-center justify-center gap-1.5 rounded-[14px] border border-input-border bg-input px-3.5 py-2.5 active:opacity-70"
                      onPress={() => setRoutes([...routes, newRoute("")])}
                    >
                      <SymbolView
                        name="plus"
                        size={13}
                        tintColorClassName="accent-icon-subtle"
                        type="monochrome"
                      />
                      <Text className="text-xs font-t3-bold tracking-[0.8px] uppercase text-foreground">
                        Add URL
                      </Text>
                    </Pressable>
                  )}
                  <View className="flex-row items-center justify-between gap-3">
                    <View className="flex-1 gap-0.5">
                      <Text className="text-sm text-foreground">Always use the preferred URL</Text>
                      <Text className="text-xs text-foreground-muted">
                        Off dials every address at once and keeps the first one that answers.
                      </Text>
                    </View>
                    <ThemedSwitch value={pinnedRoute} onValueChange={setPinnedRoute} />
                  </View>
                </>
              )}
            </>
          )}

          {Platform.OS === "android" ? (
            <View className="flex-row items-center justify-end gap-2">
              {props.environment.isRelayManaged ? null : (
                <View className="flex-1">
                  <MaterialButton
                    label="Save"
                    tone="primary"
                    fullWidth
                    onPress={() => {
                      void handleSave();
                    }}
                  />
                </View>
              )}
              <MaterialIconButton
                accessibilityLabel="Reconnect environment"
                icon="arrow.clockwise"
                variant="tonal"
                disabled={!enabled}
                onPress={() => props.onReconnect(props.environment.environmentId)}
              />
              <MaterialIconButton
                accessibilityLabel="Remove environment"
                icon="trash"
                variant="danger"
                onPress={() => props.onRemove(props.environment.environmentId)}
              />
            </View>
          ) : (
            <View className="flex-row justify-end gap-2">
              {props.environment.isRelayManaged ? null : (
                <Pressable
                  className="min-h-[42px] flex-1 flex-row items-center justify-center gap-1.5 rounded-[14px] bg-primary px-3.5 py-2.5 active:opacity-70"
                  onPress={handleSave}
                >
                  <SymbolView
                    name="checkmark"
                    size={13}
                    tintColorClassName="accent-primary-foreground"
                    type="monochrome"
                  />
                  <Text className="text-xs font-t3-bold tracking-[0.8px] uppercase text-primary-foreground">
                    Save
                  </Text>
                </Pressable>
              )}

              <Pressable
                className="h-[42px] w-[42px] items-center justify-center rounded-[14px] border border-input-border bg-input active:opacity-70 disabled:opacity-40"
                disabled={!enabled}
                onPress={() => props.onReconnect(props.environment.environmentId)}
              >
                <SymbolView
                  name="arrow.clockwise"
                  size={14}
                  tintColorClassName="accent-icon-subtle"
                  type="monochrome"
                />
              </Pressable>

              <Pressable
                className="h-[42px] w-[42px] items-center justify-center rounded-[14px] border border-danger-border bg-danger active:opacity-70"
                onPress={() => props.onRemove(props.environment.environmentId)}
              >
                <SymbolView
                  name="trash"
                  size={14}
                  tintColorClassName="accent-danger-foreground"
                  type="monochrome"
                />
              </Pressable>
            </View>
          )}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
