import type { BearerConnectionProfile } from "@t3tools/client-runtime/connection";
import { type RouteProbeResult, routeProbeLabel } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { probeRoute, updateBearerConnection } from "~/connection/onboarding";
import { cn } from "~/lib/utils";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";

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

function RouteRow({
  url,
  environmentId,
  preferred,
  removable,
  onChange,
  onRemove,
}: {
  readonly url: string;
  readonly environmentId: EnvironmentId;
  readonly preferred: boolean;
  readonly removable: boolean;
  readonly onChange: (url: string) => void;
  readonly onRemove: () => void;
}) {
  const probe = useRouteProbe(url, environmentId);
  const tone =
    probe === null
      ? "text-muted-foreground"
      : probe.status === "reachable"
        ? "text-success-foreground"
        : "text-destructive";
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Input
          value={url}
          onChange={(event) => onChange(event.target.value)}
          placeholder="https://machine.tailnet.ts.net"
          aria-label={preferred ? "Preferred URL" : "Other URL"}
          spellCheck={false}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Remove URL"
          disabled={!removable}
          className="text-muted-foreground hover:text-foreground"
          onClick={onRemove}
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
      <p className={cn("text-[11px]", tone)}>
        {preferred ? "Preferred" : null}
        {preferred && url.trim() !== "" ? " · " : null}
        {url.trim() === "" ? null : routeProbeLabel(probe)}
      </p>
    </div>
  );
}

/**
 * Edits a saved pairing: its name and every address that reaches the machine.
 * The first address is preferred. Routes are dialed together and the first to
 * answer wins unless the preferred one is pinned. Each address is checked from
 * this device as it is typed.
 */
export function EditSavedBackendDialog({
  profile,
  onClose,
}: {
  readonly profile: BearerConnectionProfile;
  readonly onClose: () => void;
}) {
  const [label, setLabel] = useState(profile.label);
  const [routes, setRoutes] = useState<ReadonlyArray<{ id: number; url: string }>>(() =>
    [profile.httpBaseUrl, ...(profile.alternateHttpBaseUrls ?? [])].map(newRoute),
  );
  const [pinnedRoute, setPinnedRoute] = useState(profile.pinnedRoute === true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const update = useAtomCommand(updateBearerConnection, { reportFailure: false });

  const handleSave = async () => {
    const [httpBaseUrl = "", ...alternateHttpBaseUrls] = routes
      .map((route) => route.url.trim())
      .filter((route) => route !== "");
    setSaving(true);
    setError(null);
    const result = await update({
      environmentId: profile.environmentId,
      label,
      httpBaseUrl,
      alternateHttpBaseUrls,
      pinnedRoute,
    });
    setSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : "Could not update environment.");
      }
      return;
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit environment</DialogTitle>
          <DialogDescription>
            Add every address this device can use to reach the machine, such as a LAN address and a
            tailnet address. The first one is preferred.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-foreground">Label</span>
            <Input value={label} onChange={(event) => setLabel(event.target.value)} />
          </label>
          <div className="space-y-2">
            <span className="block text-xs font-medium text-foreground">URLs</span>
            {routes.map((route, index) => (
              <RouteRow
                key={route.id}
                url={route.url}
                environmentId={profile.environmentId}
                preferred={index === 0}
                removable={routes.length > 1}
                onChange={(url) => setRoutes(routes.with(index, { ...route, url }))}
                onRemove={() => setRoutes(routes.filter((candidate) => candidate !== route))}
              />
            ))}
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setRoutes([...routes, newRoute("")])}
            >
              <PlusIcon className="size-3" />
              Add URL
            </Button>
          </div>
          <label className="flex items-center justify-between gap-4">
            <span className="min-w-0">
              <span className="block text-xs font-medium text-foreground">
                Always use the preferred URL
              </span>
              <span className="block text-[11px] text-muted-foreground">
                Off dials every address at once and keeps the first one that answers.
              </span>
            </span>
            <Switch size="sm" checked={pinnedRoute} onCheckedChange={setPinnedRoute} />
          </label>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
