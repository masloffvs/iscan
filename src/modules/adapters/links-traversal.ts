import moment from "moment";

export type TraversedFile = {
  path: string;
  isDirectory: boolean;
  size?: string;
  lastModified?: moment.Moment;
};

export function asLinksTraversal(response: string): TraversedFile[] {
  const files: TraversedFile[] = [];
  const trimmed = response.trim();

  // Strategy 1: JSON APIs (e.g., custom directory indexers, React/Vue frontend APIs)
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed);
      const list = Array.isArray(data)
        ? data
        : data.files || data.data || data.list || data.contents || [];

      if (Array.isArray(list)) {
        for (const item of list) {
          const path = item.name || item.url || item.path || item.key;
          if (!path) continue;

          const rawDate = item.mtime || item.updated_at || item.lastModified;

          files.push({
            path: String(path),
            isDirectory:
              item.type === "directory" ||
              item.type === "dir" ||
              String(path).endsWith("/"),
            size: item.size?.toString(),
            lastModified: rawDate ? moment(rawDate) : undefined,
          });
        }
        if (files.length > 0) return files;
      }
    } catch {
      // Ignore JSON parse errors and fallback to other strategies
    }
  }

  // Strategy 2: AWS S3 XML Bucket Listings
  if (trimmed.includes("<ListBucketResult")) {
    const contentsRegex = /<Contents>(.*?)<\/Contents>/gis;
    let match;
    while ((match = contentsRegex.exec(trimmed)) !== null) {
      const content = match[1];
      if (!content) continue;
      
      const keyMatch = content.match(/<Key>([^<]+)<\/Key>/i);
      if (keyMatch && keyMatch[1]) {
        const path = keyMatch[1];
        const sizeMatch = content.match(/<Size>([^<]+)<\/Size>/i);
        const dateMatch = content.match(/<LastModified>([^<]+)<\/LastModified>/i);
        files.push({
          path,
          isDirectory: path.endsWith("/"),
          size: sizeMatch && sizeMatch[1] ? sizeMatch[1] : undefined,
          lastModified: dateMatch && dateMatch[1] ? moment(dateMatch[1]) : undefined,
        });
      }
    }

    const prefixRegex = /<CommonPrefixes>.*?<Prefix>([^<]+)<\/Prefix>.*?<\/CommonPrefixes>/gis;
    let pMatch;
    while ((pMatch = prefixRegex.exec(trimmed)) !== null) {
      if (pMatch[1]) {
        files.push({ path: pMatch[1], isDirectory: true });
      }
    }

    if (files.length > 0) return files;
  }

  // Strategy 3: HTML Links (Apache, Nginx, IIS, Lighttpd)
  const hrefRegex = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1[^>]*>/gi;
  let match;
  while ((match = hrefRegex.exec(response)) !== null) {
    let url = match[2];

    if (!url) continue;

    // Ignore parent directory pointers
    if (url === "../" || url === "./" || url === "/" || url === "..") continue;

    // Ignore query parameters often used for sorting in Apache/Nginx (e.g. ?C=N;O=D)
    if (url.startsWith("?")) continue;

    // Ignore absolute URLs pointing outside and javascript links
    if (
      url.startsWith("http://") ||
      url.startsWith("https://") ||
      url.startsWith("javascript:") ||
      url.startsWith("mailto:")
    ) {
      continue;
    }

    // Ignore cpanel redirects and other explicit server commands
    if (url.startsWith("/cgi-sys/")) continue;

    // Strip hash fragments
    const hashIndex = url.indexOf("#");
    if (hashIndex !== -1) {
      url = url.substring(0, hashIndex);
    }
    
    if (!url) continue;

    // Decode URL entities (e.g., %20 -> space)
    try {
      url = decodeURIComponent(url);
    } catch {
      // Ignore malformed URI components
    }
    
    // Look ahead to parse size and lastModified
    const lookaheadString = response.substring(hrefRegex.lastIndex, hrefRegex.lastIndex + 300);
    const rowContentMatch = lookaheadString.match(/^(.*?)(?:\n|<\/?tr>|<a\s)/i);
    const rowContent = rowContentMatch && rowContentMatch[1] !== undefined ? rowContentMatch[1] : lookaheadString;
    
    // Strip tags and excessive spaces
    const plainText = rowContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    
    let lastModified: moment.Moment | undefined;
    let size: string | undefined;
    
    // Match date formats like "21-Jan-2025 00:26" or "2023-01-01 12:00:00"
    const dateMatch = plainText.match(/\b(\d{2}-[A-Za-z]{3}-\d{4} \d{2}:\d{2}|\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?)\b/);
    
    if (dateMatch) {
      // Create moment object directly from the matched date string
      // The supported formats are usually parsed correctly by moment's loose mode
      const rawDate = dateMatch[1];
      const parsedMoment = moment(rawDate, ["DD-MMM-YYYY HH:mm", "YYYY-MM-DD HH:mm:ss", "YYYY-MM-DD HH:mm"]);
      if (parsedMoment.isValid()) {
        lastModified = parsedMoment;
      }
      
      const afterDate = plainText.substring(dateMatch.index! + dateMatch[0].length).trim();
      
      // Match size (e.g., 38293, 1.2K, 50M, 1,234)
      const sizeMatch = afterDate.match(/^([0-9.,]+[KMGTP]?|-)\b/i);
      if (sizeMatch && sizeMatch[1] !== "-") {
        size = sizeMatch[1];
      }
    }

    files.push({
      path: url,
      isDirectory: url.endsWith("/"),
      size,
      lastModified
    });
  }

  // Deduplicate files by path to prevent multiple links to the same file in complex HTML tables
  const uniqueFiles = new Map<string, TraversedFile>();
  for (const f of files) {
    if (!uniqueFiles.has(f.path)) {
      uniqueFiles.set(f.path, f);
    }
  }

  return Array.from(uniqueFiles.values());
}
