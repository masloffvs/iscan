import { useEffect, useMemo, useState } from "react";

import {
  getRemoteZoomEyeHostDetail,
  type RemoteZoomEyeHostDetail,
} from "../api/client";
import workbookTheme from "../theme.tsx";
import {
  defineApplication,
  type ApplicationViewProps,
} from "./application";
import {
  ApplicationAlert,
  ApplicationChoiceButton,
  ApplicationEmptyState,
  ApplicationHeader,
  ApplicationMetaRow,
  ApplicationPanel,
  ApplicationSurface,
} from "./application-layout";

export const ZOOMEYE_HOST_APPLICATION_ID = "applications/zoomeye-host";

type ZoomEyeHostTab = "overview" | "body" | "headers" | "raw";

export type ZoomEyeHostInput = {
  ip: string;
  port: number;
  initialTitle?: string | null;
};

export function createZoomEyeHostInstanceTitle(input: ZoomEyeHostInput): string {
  const customTitle = input.initialTitle?.trim();
  if (customTitle) {
    return customTitle;
  }

  return `${input.ip}:${input.port}`;
}

function formatHostViewerMeta(host: RemoteZoomEyeHostDetail | null): string {
  if (!host) {
    return "Persisted ZoomEye host detail from the local store.";
  }

  return [
    host.title,
    host.product,
    host.organization,
    host.countryNameEn ?? host.countryCode,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" · ");
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) {
    return null;
  }

  return (
    <div className={`rounded-[12px] ${workbookTheme.surface.panelMuted} px-3 py-2`}>
      <p className={`text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>{label}</p>
      <p className={`mt-1 text-[12px] leading-relaxed ${workbookTheme.text.primary}`}>{value}</p>
    </div>
  );
}

function ZoomEyeHostApp({
  instance,
  setTitle,
}: ApplicationViewProps<ZoomEyeHostInput>) {
  const input = instance.input;
  const [activeTab, setActiveTab] = useState<ZoomEyeHostTab>("overview");
  const [host, setHost] = useState<RemoteZoomEyeHostDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(createZoomEyeHostInstanceTitle(input));
  }, [input, setTitle]);

  useEffect(() => {
    let disposed = false;
    setIsLoading(true);
    setError(null);

    void getRemoteZoomEyeHostDetail(input.ip, input.port)
      .then((result) => {
        if (disposed) {
          return;
        }

        setHost(result);
        if (result) {
          const nextTitle = result.title?.trim() || result.product?.trim() || `${result.ip}:${result.port}`;
          setTitle(`${result.ip}:${result.port} · ${nextTitle}`);
        }
      })
      .catch((loadError) => {
        if (disposed) {
          return;
        }

        setHost(null);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!disposed) {
          setIsLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [input.ip, input.port, setTitle]);

  const rawJson = useMemo(
    () => host?.raw ? JSON.stringify(host.raw, null, 2) : null,
    [host?.raw],
  );

  return (
    <ApplicationSurface>
      <ApplicationHeader
        title={host ? `${host.ip}:${host.port}` : createZoomEyeHostInstanceTitle(input)}
        subtitle={formatHostViewerMeta(host)}
        meta={(
          <ApplicationMetaRow>
            <span>{host?.service ?? "unknown service"}</span>
            {host?.transport ? <span>{host.transport}</span> : null}
            {host?.matchType ? <span>{host.matchType}</span> : null}
            {host?.searchType ? <span>{host.searchType}</span> : null}
            {host?.lastPulledAt ? <span>{host.lastPulledAt}</span> : null}
          </ApplicationMetaRow>
        )}
        alert={error ? <ApplicationAlert>{error}</ApplicationAlert> : undefined}
      />

      <div className="min-h-0 flex-1 space-y-4 pt-2">
        <section>
          <div className={`flex flex-wrap gap-1 rounded-[12px] ${workbookTheme.surface.panel} p-1`}>
            {([
              ["overview", "Overview"],
              ["body", "Body"],
              ["headers", "Headers"],
              ["raw", "Raw"],
            ] as const).map(([tabId, label]) => (
              <ApplicationChoiceButton
                key={tabId}
                onClick={() => setActiveTab(tabId)}
                isActive={activeTab === tabId}
                className="min-w-[74px] justify-center"
              >
                {label}
              </ApplicationChoiceButton>
            ))}
          </div>
        </section>

        {isLoading ? (
          <ApplicationEmptyState text="Loading ZoomEye host details..." />
        ) : error ? (
          <ApplicationEmptyState text="Host detail could not be loaded from the local store." />
        ) : !host ? (
          <ApplicationEmptyState text="Host details are not available in the local store." />
        ) : activeTab === "overview" ? (
          <ApplicationPanel title="Overview" subtitle="Persisted endpoint metadata and ZoomEye fields.">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <DetailRow label="Endpoint" value={`${host.ip}:${host.port}`} />
              <DetailRow label="Service" value={[host.service, host.transport].filter(Boolean).join("/") || null} />
              <DetailRow label="Product" value={host.product} />
              <DetailRow label="Hostname" value={host.hostname} />
              <DetailRow label="Operating System" value={host.os} />
              <DetailRow label="Title" value={host.title} />
              <DetailRow label="Organization" value={host.organization} />
              <DetailRow label="Country" value={host.countryNameEn ?? host.countryCode} />
              <DetailRow label="City" value={host.cityNameEn} />
              <DetailRow label="Region" value={host.subdivisionNameEn} />
              <DetailRow label="ASN" value={host.asn} />
              <DetailRow label="Match Type" value={host.matchType} />
              <DetailRow label="Query" value={host.queryText ?? host.queryBase64} />
              <DetailRow label="Search Type" value={host.searchType} />
              <DetailRow label="Extra Info" value={host.extraInfo} />
              <DetailRow label="Token" value={host.token} />
              <DetailRow label="QID" value={host.qid} />
              <DetailRow label="ZoomEye Timestamp" value={host.zoomeyeTimestamp} />
              <DetailRow label="First Pulled" value={host.firstPulledAt} />
              <DetailRow label="Last Pulled" value={host.lastPulledAt} />
            </div>
          </ApplicationPanel>
        ) : activeTab === "body" ? (
          <ApplicationPanel title="Response Body" subtitle="Stored response body for this endpoint.">
            {host.body ? (
              <pre className={`overflow-auto rounded-[14px] ${workbookTheme.surface.panel} p-4 text-[11px] leading-relaxed ${workbookTheme.text.body} whitespace-pre-wrap break-words`}>
                {host.body}
              </pre>
            ) : (
              <ApplicationEmptyState text="No response body is stored for this host." />
            )}
          </ApplicationPanel>
        ) : activeTab === "headers" ? (
          <ApplicationPanel title="Headers" subtitle="Stored HTTP header and banner fields.">
            <div className="space-y-3">
              <div className={`rounded-[14px] ${workbookTheme.surface.panel} p-4`}>
                <p className={`text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Header</p>
                <pre className={`mt-2 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed ${workbookTheme.text.body}`}>
                  {host.header ?? "No header is stored for this host."}
                </pre>
              </div>
              <div className={`rounded-[14px] ${workbookTheme.surface.panel} p-4`}>
                <p className={`text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Banner</p>
                <pre className={`mt-2 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed ${workbookTheme.text.body}`}>
                  {host.banner ?? "No banner is stored for this host."}
                </pre>
              </div>
            </div>
          </ApplicationPanel>
        ) : (
          <ApplicationPanel title="Raw Payload" subtitle="Original ZoomEye payload persisted in the local store.">
            {rawJson ? (
              <pre className={`overflow-auto rounded-[14px] ${workbookTheme.surface.panel} p-4 text-[11px] leading-relaxed ${workbookTheme.text.body} whitespace-pre-wrap break-words`}>
                {rawJson}
              </pre>
            ) : (
              <ApplicationEmptyState text="No raw ZoomEye payload is stored for this host." />
            )}
          </ApplicationPanel>
        )}
      </div>
    </ApplicationSurface>
  );
}

export const zoomeyeHostApplication = defineApplication<ZoomEyeHostInput>({
  id: ZOOMEYE_HOST_APPLICATION_ID,
  title: "ZoomEye Host",
  View: ZoomEyeHostApp,
  getInitialTitle: createZoomEyeHostInstanceTitle,
});