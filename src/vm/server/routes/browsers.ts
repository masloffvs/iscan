import type { CloakKit, CloakProfile } from "../../../kits/cloak-kit";
import { MicrolinkUaKit } from "../../../kits/microlink-ua-kit";
import type { ProxyKit } from "../../../kits/proxy-kit";
import { formatProxyProfileUrl } from "../../../modules/kits/proxy-shared";
import { createJsonResponse, createMethodNotAllowedResponse, readJsonBody, VmServerHttpError } from "../http";
import {
  readVmBrowserActionRequestBody,
  readVmBrowserClickRequestBody,
  readVmBrowserGestureRequestBody,
  readVmBrowserKeyboardRequestBody,
  readVmBrowserNavigateRequestBody,
  readVmBrowserProfileUpdateRequestBody,
  readVmBrowserTabActivationRequestBody,
  readVmBrowserWheelRequestBody,
} from "../parsers";
import {
  createVmBrowserProfilePayload,
  createVmMicrolinkUaPayload,
  resolveVmBrowserProfile,
} from "../browser-helpers";

export async function handleBrowserRoutes(
  request: Request,
  url: URL,
  ensureCloakKit: () => Promise<CloakKit>,
  ensureProxyKit: () => Promise<ProxyKit>,
  ensureUserAgentKit: () => Promise<MicrolinkUaKit>,
): Promise<Response | null> {
  if (url.pathname === "/vm/browsers") {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    const kit = await ensureCloakKit();
    const profiles = kit.getProfiles();
    const browsers = profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      proxy: profile.proxy,
      userDataDir: profile.userDataDir,
      headless: profile.headless ?? false,
      humanize: profile.humanize ?? false,
      isRunning: kit.isProfileRunning(profile.id),
      profileDir: profile.userDataDir,
      currentUrl: kit.getProfileCurrentUrl(profile.id),
    }));

    return createJsonResponse({
      ok: true,
      result: { browsers },
    });
  }

  const browserProfileMatch = url.pathname.match(/^\/vm\/browsers\/([^/]+)\/profile$/u);
  if (browserProfileMatch) {
    const target = decodeURIComponent(browserProfileMatch[1]!);
    const cloakKit = await ensureCloakKit();
    const userAgentKit = await ensureUserAgentKit();
    const proxyKit = await ensureProxyKit();
    const profile = resolveVmBrowserProfile(cloakKit.getProfiles(), target);
    const proxyProfiles = proxyKit.getProxies();

    if (request.method === "GET") {
      return createJsonResponse({
        ok: true,
        result: await createVmBrowserProfilePayload(cloakKit, userAgentKit, profile, proxyProfiles),
      });
    }

    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["GET", "POST"]);
    }

    const body = readVmBrowserProfileUpdateRequestBody(await readJsonBody(request));
    const selectedProxy = (() => {
      if (body.proxySelection.mode !== "saved") {
        return null;
      }

      const exactIdMatch = proxyProfiles.find((entry) => entry.id === body.proxySelection.proxyId);
      if (exactIdMatch) {
        return exactIdMatch;
      }

      const exactNameMatches = proxyProfiles.filter((entry) => entry.name === body.proxySelection.proxyId);
      if (exactNameMatches.length === 1) {
        return exactNameMatches[0]!;
      }

      if (exactNameMatches.length > 1) {
        throw new VmServerHttpError(409, `Proxy target '${body.proxySelection.proxyId}' is ambiguous. Use a proxy id.`);
      }

      throw new VmServerHttpError(404, `Proxy '${body.proxySelection.proxyId}' was not found.`);
    })();

    const updatedProfile: CloakProfile = {
      ...profile,
      headless: body.headless,
      humanize: body.humanize,
      locale: body.locale,
      name: body.name,
      proxy: body.proxySelection.mode === "saved"
        ? formatProxyProfileUrl(selectedProxy!)
        : body.proxySelection.mode === "none"
          ? undefined
          : profile.proxy,
      searchEngine: body.searchEngine,
      timezone: body.timezone,
      userAgent: body.userAgent,
      userDataDir: body.userDataDir,
      viewportHeight: body.viewportHeight,
      viewportWidth: body.viewportWidth,
    };

    await cloakKit.saveProfile(updatedProfile);

    return createJsonResponse({
      ok: true,
      result: await createVmBrowserProfilePayload(cloakKit, userAgentKit, updatedProfile, proxyProfiles),
    });
  }

  const browserTabsMatch = url.pathname.match(/^\/vm\/browsers\/([^/]+)\/tabs$/u);
  if (browserTabsMatch) {
    const target = decodeURIComponent(browserTabsMatch[1]!);
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    const kit = await ensureCloakKit();
    const tabs = await kit.listProfileTabs(target);

    return createJsonResponse({
      ok: true,
      result: { target, tabs },
    });
  }

  const browserActivateTabMatch = url.pathname.match(/^\/vm\/browsers\/([^/]+)\/tabs\/activate$/u);
  if (browserActivateTabMatch) {
    const target = decodeURIComponent(browserActivateTabMatch[1]!);
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmBrowserTabActivationRequestBody(await readJsonBody(request));
    const kit = await ensureCloakKit();
    await kit.activateProfileTab(target, body.tabId);

    return createJsonResponse({
      ok: true,
      result: { target, tabId: body.tabId },
    });
  }

  if (url.pathname === "/vm/browsers/launch") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmBrowserActionRequestBody(await readJsonBody(request));
    const kit = await ensureCloakKit();
    await kit.launchProfile(body.target, { headless: true });

    return createJsonResponse({ ok: true, result: { target: body.target } });
  }

  if (url.pathname === "/vm/browsers/navigate") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmBrowserNavigateRequestBody(await readJsonBody(request));
    const kit = await ensureCloakKit();
    await kit.navigateProfile(body.target, body.url!);

    return createJsonResponse({ ok: true, result: { target: body.target } });
  }

  if (url.pathname === "/vm/browsers/screenshot") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmBrowserActionRequestBody(await readJsonBody(request));
    const kit = await ensureCloakKit();
    const dataUrl = await kit.captureProfileScreenshot(body.target);

    return createJsonResponse({ ok: true, result: { target: body.target, dataUrl } });
  }

  if (url.pathname === "/vm/browsers/click") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmBrowserClickRequestBody(await readJsonBody(request));
    const kit = await ensureCloakKit();
    await kit.clickProfile(body.target, body.x, body.y);

    return createJsonResponse({ ok: true, result: { target: body.target } });
  }

  if (url.pathname === "/vm/browsers/gesture") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmBrowserGestureRequestBody(await readJsonBody(request));
    const kit = await ensureCloakKit();
    await kit.gestureProfile(body.target, body.points);

    return createJsonResponse({ ok: true, result: { target: body.target } });
  }

  if (url.pathname === "/vm/browsers/wheel") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmBrowserWheelRequestBody(await readJsonBody(request));
    const kit = await ensureCloakKit();
    await kit.wheelProfile(body.target, body.x, body.y, body.deltaX, body.deltaY);

    return createJsonResponse({ ok: true, result: { target: body.target } });
  }

  if (url.pathname === "/vm/browsers/keyboard") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmBrowserKeyboardRequestBody(await readJsonBody(request));
    const kit = await ensureCloakKit();
    await kit.keyboardProfile(body.target, body);

    return createJsonResponse({ ok: true, result: { target: body.target } });
  }

  if (url.pathname === "/vm/browsers/stop") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmBrowserActionRequestBody(await readJsonBody(request));
    const kit = await ensureCloakKit();
    await kit.stopProfile(body.target);

    return createJsonResponse({ ok: true, result: { target: body.target } });
  }

  if (url.pathname === "/vm/kits/microlink-ua") {
    const userAgentKit = await ensureUserAgentKit();

    if (request.method === "GET") {
      return createJsonResponse({ ok: true, result: await createVmMicrolinkUaPayload(userAgentKit) });
    }

    if (request.method === "POST") {
      await userAgentKit.refresh();
      return createJsonResponse({ ok: true, result: await createVmMicrolinkUaPayload(userAgentKit) });
    }

    return createMethodNotAllowedResponse(["GET", "POST"]);
  }

  return null;
}
