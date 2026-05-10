export type ReadableHeaderDetails = {
  summary: string;
  details: string[];
  tags: string[];
};

export type ReadableHeaderRow = {
  id: string;
  headerName: string;
  headerLabel: string;
  rawValue: string;
  parsed: ReadableHeaderDetails | null;
};

export function titleCaseHeaderName(name: string): string {
  return name
    .split("-")
    .map((segment) => segment.length <= 2
      ? segment.toUpperCase()
      : `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
    .join("-");
}

function formatReadableToken(name: string): string {
  return name
    .replace(/[_-]+/gu, " ")
    .trim()
    .split(/\s+/gu)
    .map((segment) => segment.length <= 2
      ? segment.toUpperCase()
      : `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

function truncateMiddle(value: string, maxLength = 56): string {
  if (value.length <= maxLength) {
    return value;
  }

  const available = maxLength - 1;
  const headLength = Math.ceil(available / 2);
  const tailLength = Math.floor(available / 2);
  return `${value.slice(0, headLength)}…${value.slice(value.length - tailLength)}`;
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function stripWrappingQuotes(value: string): string {
  return value.startsWith('"') && value.endsWith('"') && value.length >= 2
    ? value.slice(1, -1)
    : value;
}

function formatCookieAttributeName(name: string): string {
  const normalizedName = name.toLowerCase();
  if (normalizedName === "httponly") {
    return "HttpOnly";
  }

  if (normalizedName === "samesite") {
    return "SameSite";
  }

  if (normalizedName === "max-age") {
    return "Max-Age";
  }

  return titleCaseHeaderName(normalizedName);
}

export function splitSetCookieHeaderValue(value: string): string[] {
  const newlineEntries = value
    .split(/\r?\n/gu)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (newlineEntries.length > 1) {
    return newlineEntries;
  }

  return value
    .split(/,\s*(?=[!#$%&'*+.^_`|~0-9A-Za-z-]+=)/gu)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseCookieHeaderValue(value: string): ReadableHeaderDetails {
  const segments = value.split(";").map((segment) => segment.trim()).filter((segment) => segment.length > 0);
  const [nameValue = value, ...attributeSegments] = segments;
  const separatorIndex = nameValue.indexOf("=");
  const cookieName = separatorIndex >= 0 ? nameValue.slice(0, separatorIndex).trim() : nameValue.trim();
  const cookieValue = separatorIndex >= 0 ? nameValue.slice(separatorIndex + 1).trim() : "";
  const details: string[] = [];
  const tags: string[] = [];

  for (const segment of attributeSegments) {
    const attributeSeparatorIndex = segment.indexOf("=");
    if (attributeSeparatorIndex < 0) {
      tags.push(formatCookieAttributeName(segment));
      continue;
    }

    const attributeName = segment.slice(0, attributeSeparatorIndex).trim();
    const attributeValue = segment.slice(attributeSeparatorIndex + 1).trim();
    const normalizedAttributeName = attributeName.toLowerCase();

    if (normalizedAttributeName === "expires") {
      const expiresDate = new Date(attributeValue);
      details.push(Number.isNaN(expiresDate.getTime())
        ? `Expires ${attributeValue}`
        : `Expires ${expiresDate.toLocaleString()}`);
      continue;
    }

    if (normalizedAttributeName === "max-age") {
      details.push(`Max-Age ${attributeValue}s`);
      continue;
    }

    details.push(`${formatCookieAttributeName(attributeName)} ${attributeValue}`);
  }

  return {
    summary: `${cookieName || "cookie"}=${truncateMiddle(cookieValue || "<empty>", 44)}`,
    details,
    tags,
  };
}

function parseRequestCookieHeaderValue(value: string): ReadableHeaderDetails {
  const cookies = value
    .split(";")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return {
    summary: cookies.length <= 1 ? truncateMiddle(cookies[0] ?? value, 52) : `${cookies.length} cookies`,
    details: cookies.length <= 1 ? [] : cookies.map((cookie) => truncateMiddle(cookie, 60)),
    tags: [],
  };
}

function parseContentTypeHeaderValue(value: string): ReadableHeaderDetails {
  const [mediaType = value, ...parameterSegments] = value.split(";").map((segment) => segment.trim()).filter((segment) => segment.length > 0);
  const details = parameterSegments.map((segment) => {
    const separatorIndex = segment.indexOf("=");
    if (separatorIndex < 0) {
      return segment;
    }

    const name = segment.slice(0, separatorIndex).trim();
    const parameterValue = stripWrappingQuotes(segment.slice(separatorIndex + 1).trim());
    return `${formatReadableToken(name)} ${parameterValue}`;
  });

  return {
    summary: mediaType,
    details,
    tags: [],
  };
}

function parseCacheControlHeaderValue(value: string): ReadableHeaderDetails {
  const directives = value.split(",").map((segment) => segment.trim()).filter((segment) => segment.length > 0);
  return {
    summary: directives.length > 0 ? `${directives.length} directives` : value,
    details: [],
    tags: directives,
  };
}

function parseContentSecurityPolicyHeaderValue(value: string): ReadableHeaderDetails {
  const directives = value
    .split(";")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return {
    summary: directives.length > 0 ? `${directives.length} directives` : value,
    details: directives,
    tags: directives
      .map((directive) => directive.split(/\s+/gu)[0])
      .filter((directive): directive is string => typeof directive === "string" && directive.length > 0),
  };
}

function parseStrictTransportSecurityHeaderValue(value: string): ReadableHeaderDetails {
  const directives = value
    .split(";")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const details: string[] = [];
  const tags: string[] = [];
  let maxAgeSummary: string | null = null;

  for (const directive of directives) {
    const separatorIndex = directive.indexOf("=");
    if (separatorIndex < 0) {
      tags.push(formatReadableToken(directive));
      continue;
    }

    const name = directive.slice(0, separatorIndex).trim();
    const directiveValue = stripWrappingQuotes(directive.slice(separatorIndex + 1).trim());
    if (name.toLowerCase() === "max-age") {
      maxAgeSummary = `Max-Age ${directiveValue}s`;
      continue;
    }

    details.push(`${formatReadableToken(name)} ${directiveValue}`);
  }

  return {
    summary: maxAgeSummary ?? `${directives.length} directives`,
    details,
    tags,
  };
}

function parseWwwAuthenticateHeaderValue(value: string): ReadableHeaderDetails {
  const trimmedValue = value.trim();
  const match = trimmedValue.match(/^([A-Za-z][A-Za-z0-9_-]*)(?:\s+(.*))?$/u);
  if (!match) {
    return {
      summary: trimmedValue,
      details: [],
      tags: [],
    };
  }

  const [, scheme, parametersPart = ""] = match;
  const parameters = parametersPart.length === 0
    ? []
    : parametersPart
      .split(/,\s*(?=[A-Za-z][A-Za-z_-]*=)/gu)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

  const details = parameters.map((segment) => {
    const separatorIndex = segment.indexOf("=");
    if (separatorIndex < 0) {
      return segment;
    }

    const name = segment.slice(0, separatorIndex).trim();
    const parameterValue = stripWrappingQuotes(segment.slice(separatorIndex + 1).trim());
    return `${formatReadableToken(name)} ${parameterValue}`;
  });

  return {
    summary: scheme,
    details,
    tags: [],
  };
}

function parseAuthorizationHeaderValue(value: string): ReadableHeaderDetails {
  const trimmedValue = value.trim();
  const separatorIndex = trimmedValue.indexOf(" ");
  if (separatorIndex < 0) {
    return {
      summary: truncateMiddle(trimmedValue, 52),
      details: [],
      tags: [],
    };
  }

  const scheme = trimmedValue.slice(0, separatorIndex).trim();
  const credential = trimmedValue.slice(separatorIndex + 1).trim();
  return {
    summary: scheme,
    details: [truncateMiddle(credential, 60)],
    tags: [],
  };
}

function parseNumericHeaderValue(value: string): ReadableHeaderDetails | null {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) {
    return null;
  }

  return {
    summary: `${parsedValue.toLocaleString()} bytes`,
    details: [formatBytes(parsedValue)],
    tags: [],
  };
}

function parseDateHeaderValue(value: string): ReadableHeaderDetails | null {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return {
    summary: parsedDate.toLocaleString(),
    details: [parsedDate.toUTCString()],
    tags: [],
  };
}

export function parseReadableHeaderValue(headerName: string, value: string): ReadableHeaderDetails | null {
  const normalizedHeaderName = headerName.toLowerCase();

  if (normalizedHeaderName === "set-cookie") {
    return parseCookieHeaderValue(value);
  }

  if (normalizedHeaderName === "cookie") {
    return parseRequestCookieHeaderValue(value);
  }

  if (normalizedHeaderName === "content-type") {
    return parseContentTypeHeaderValue(value);
  }

  if (normalizedHeaderName === "cache-control") {
    return parseCacheControlHeaderValue(value);
  }

  if (normalizedHeaderName === "content-security-policy") {
    return parseContentSecurityPolicyHeaderValue(value);
  }

  if (normalizedHeaderName === "strict-transport-security") {
    return parseStrictTransportSecurityHeaderValue(value);
  }

  if (normalizedHeaderName === "www-authenticate") {
    return parseWwwAuthenticateHeaderValue(value);
  }

  if (normalizedHeaderName === "authorization") {
    return parseAuthorizationHeaderValue(value);
  }

  if (normalizedHeaderName === "content-length") {
    return parseNumericHeaderValue(value);
  }

  if (["date", "last-modified", "expires"].includes(normalizedHeaderName)) {
    return parseDateHeaderValue(value);
  }

  return null;
}

export function buildReadableHeaderRows(headers: Record<string, string>): ReadableHeaderRow[] {
  const rows: ReadableHeaderRow[] = [];

  for (const [headerName, headerValue] of Object.entries(headers).sort(([left], [right]) => left.localeCompare(right))) {
    const normalizedHeaderName = headerName.toLowerCase();

    if (normalizedHeaderName === "set-cookie") {
      const cookieValues = splitSetCookieHeaderValue(headerValue);
      const entries = cookieValues.length > 0 ? cookieValues : [headerValue];
      entries.forEach((cookieValue, index) => {
        rows.push({
          id: `${normalizedHeaderName}-${index}`,
          headerName,
          headerLabel: entries.length > 1 ? `${titleCaseHeaderName(normalizedHeaderName)} ${index + 1}` : titleCaseHeaderName(normalizedHeaderName),
          rawValue: cookieValue,
          parsed: parseReadableHeaderValue(normalizedHeaderName, cookieValue),
        });
      });
      continue;
    }

    rows.push({
      id: headerName,
      headerName,
      headerLabel: titleCaseHeaderName(headerName),
      rawValue: headerValue,
      parsed: parseReadableHeaderValue(headerName, headerValue),
    });
  }

  return rows;
}