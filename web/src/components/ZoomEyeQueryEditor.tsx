import { autocompletion, snippetCompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { githubDarkInit } from "@uiw/codemirror-theme-github";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";

type ZoomEyeQueryEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
};

type ZoomEyeCompletionDefinition = {
  label: string;
  detail: string;
  example?: string;
  template: string;
  type: "property" | "keyword" | "operator";
  boost?: number;
};

export const ZOOMEYE_QUERY_QUICK_SNIPPETS = [
  {
    label: "SSH or HTTP",
    query: 'service="ssh" || service="http"',
  },
  {
    label: "Routers after 2020",
    query: 'device="router" && after="2020-01-01"',
  },
  {
    label: "Cisco in title",
    query: 'title="Cisco" && country="US"',
  },
  {
    label: "Known CVE",
    query: 'vul.cve="CVE-2021-44228" && is_new=true',
  },
  {
    label: "Cert subject",
    query: 'ssl.cert.subject.cn="example.com"',
  },
] as const;

const ZOOMEYE_COMPLETION_DEFINITIONS: readonly ZoomEyeCompletionDefinition[] = [
  { label: "app", detail: "Match application/component names", example: 'app="Cisco ASA SSL VPN"', template: 'app="${value}"', type: "property", boost: 96 },
  { label: "service", detail: "Match network service names", example: 'service="ssh"', template: 'service="${value}"', type: "property", boost: 96 },
  { label: "device", detail: "Match device family", example: 'device="router"', template: 'device="${value}"', type: "property", boost: 94 },
  { label: "title", detail: "Match HTML title text", example: 'title="knownsec"', template: 'title="${value}"', type: "property", boost: 94 },
  { label: "product", detail: "Match component/product text", example: 'product="Cisco"', template: 'product="${value}"', type: "property", boost: 92 },
  { label: "protocol", detail: "Match transport protocol", example: 'protocol="TCP"', template: 'protocol="${value}"', type: "property", boost: 88 },
  { label: "country", detail: "Filter by country name or code", example: 'country="US"', template: 'country="${value}"', type: "property", boost: 90 },
  { label: "subdivisions", detail: "Filter by administrative region", example: 'subdivisions="beijing"', template: 'subdivisions="${value}"', type: "property", boost: 82 },
  { label: "city", detail: "Filter by city", example: 'city="changsha"', template: 'city="${value}"', type: "property", boost: 82 },
  { label: "ip", detail: "Search a specific IPv4 or IPv6 address", example: 'ip="8.8.8.8"', template: 'ip="${value}"', type: "property", boost: 86 },
  { label: "cidr", detail: "Search a CIDR block", example: 'cidr="52.2.254.36/24"', template: 'cidr="${value}"', type: "property", boost: 80 },
  { label: "org", detail: "Match organization names", example: 'org="Stanford University"', template: 'org="${value}"', type: "property", boost: 80 },
  { label: "isp", detail: "Match ISP/network provider names", example: 'isp="China Mobile"', template: 'isp="${value}"', type: "property", boost: 74 },
  { label: "asn", detail: "Filter by autonomous system number", example: "asn=42893", template: "asn=${number}", type: "property", boost: 76 },
  { label: "port", detail: "Filter by port", example: "port=80", template: "port=${number}", type: "property", boost: 86 },
  { label: "hostname", detail: "Search hostname values", example: 'hostname="google.com"', template: 'hostname="${value}"', type: "property", boost: 80 },
  { label: "domain", detail: "Search domain or subdomain values", example: 'domain="baidu.com"', template: 'domain="${value}"', type: "property", boost: 78 },
  { label: "banner", detail: "Match protocol banner text", example: 'banner="FTP"', template: 'banner="${value}"', type: "property", boost: 78 },
  { label: "http.header", detail: "Match HTTP response header text", example: 'http.header="nginx"', template: 'http.header="${value}"', type: "property", boost: 82 },
  { label: "http.header_hash", detail: "Match HTTP header hash", example: 'http.header_hash="27f9973fe57298c3b63919259877a84d"', template: 'http.header_hash="${value}"', type: "property", boost: 70 },
  { label: "http.header.server", detail: "Match the HTTP server header", example: 'http.header.server="Nginx"', template: 'http.header.server="${value}"', type: "property", boost: 74 },
  { label: "http.header.version", detail: "Match HTTP header version text", example: 'http.header.version="1.2"', template: 'http.header.version="${value}"', type: "property", boost: 70 },
  { label: "http.header.status_code", detail: "Filter by HTTP status code", example: 'http.header.status_code="200"', template: 'http.header.status_code="${value}"', type: "property", boost: 74 },
  { label: "http.body", detail: "Match HTML body text", example: 'http.body="document"', template: 'http.body="${value}"', type: "property", boost: 78 },
  { label: "http.body_hash", detail: "Match HTTP body hash", example: 'http.body_hash="84a18166fde3ee7e7c974b8d1e7e21b4"', template: 'http.body_hash="${value}"', type: "property", boost: 66 },
  { label: "ssl", detail: "Match text inside SSL certificate metadata", example: 'ssl="google"', template: 'ssl="${value}"', type: "property", boost: 84 },
  { label: "ssl.cert.fingerprint", detail: "Match certificate fingerprint", example: 'ssl.cert.fingerprint="F3C98F223D82CC41CF83D94671CCC6C69873FABF"', template: 'ssl.cert.fingerprint="${value}"', type: "property", boost: 72 },
  { label: "ssl.chain_count", detail: "Filter by SSL chain count", example: "ssl.chain_count=3", template: "ssl.chain_count=${number}", type: "property", boost: 64 },
  { label: "ssl.cert.alg", detail: "Match certificate signature algorithm", example: 'ssl.cert.alg="SHA256-RSA"', template: 'ssl.cert.alg="${value}"', type: "property", boost: 66 },
  { label: "ssl.cert.issuer.cn", detail: "Match certificate issuer common name", example: 'ssl.cert.issuer.cn="pbx.wildix.com"', template: 'ssl.cert.issuer.cn="${value}"', type: "property", boost: 66 },
  { label: "ssl.cert.pubkey.rsa.bits", detail: "Filter by RSA public key bits", example: "ssl.cert.pubkey.rsa.bits=2048", template: "ssl.cert.pubkey.rsa.bits=${number}", type: "property", boost: 60 },
  { label: "ssl.cert.pubkey.ecdsa.bits", detail: "Filter by ECDSA public key bits", example: "ssl.cert.pubkey.ecdsa.bits=256", template: "ssl.cert.pubkey.ecdsa.bits=${number}", type: "property", boost: 60 },
  { label: "ssl.cert.pubkey.type", detail: "Match certificate public key type", example: 'ssl.cert.pubkey.type="RSA"', template: 'ssl.cert.pubkey.type="${value}"', type: "property", boost: 60 },
  { label: "ssl.cert.serial", detail: "Match certificate serial number", example: 'ssl.cert.serial="18460192207935675900910674501"', template: 'ssl.cert.serial="${value}"', type: "property", boost: 58 },
  { label: "ssl.cipher.bits", detail: "Match SSL cipher bit size", example: 'ssl.cipher.bits="128"', template: 'ssl.cipher.bits="${value}"', type: "property", boost: 58 },
  { label: "ssl.cipher.name", detail: "Match cipher suite name", example: 'ssl.cipher.name="TLS_AES_128_GCM_SHA256"', template: 'ssl.cipher.name="${value}"', type: "property", boost: 58 },
  { label: "ssl.cipher.version", detail: "Match cipher version", example: 'ssl.cipher.version="TLSv1.3"', template: 'ssl.cipher.version="${value}"', type: "property", boost: 58 },
  { label: "ssl.version", detail: "Match SSL version", example: 'ssl.version="TLSv1.3"', template: 'ssl.version="${value}"', type: "property", boost: 62 },
  { label: "ssl.cert.subject.cn", detail: "Match certificate subject common name", example: 'ssl.cert.subject.cn="example.com"', template: 'ssl.cert.subject.cn="${value}"', type: "property", boost: 68 },
  { label: "ssl.jarm", detail: "Match JARM fingerprint", example: 'ssl.jarm="29d29d15d29d29d00029d29d29d29dea0f89a2e5fb09e4d8e099befed92cfa"', template: 'ssl.jarm="${value}"', type: "property", boost: 60 },
  { label: "ssl.ja3s", detail: "Match JA3S fingerprint", example: 'ssl.ja3s="45094d08156d110d8ee97b204143db14"', template: 'ssl.ja3s="${value}"', type: "property", boost: 60 },
  { label: "industry", detail: "Match industry classification", example: 'industry="government"', template: 'industry="${value}"', type: "property", boost: 68 },
  { label: "after", detail: "Match assets updated after a date", example: 'after="2020-01-01"', template: 'after="${date}"', type: "property", boost: 76 },
  { label: "before", detail: "Match assets updated before a date", example: 'before="2020-01-01"', template: 'before="${date}"', type: "property", boost: 76 },
  { label: "dig", detail: "Match DIG content", example: 'dig="baidu.com 220.181.38.148"', template: 'dig="${value}"', type: "property", boost: 54 },
  { label: "vul.cve", detail: "Match CVE identifier", example: 'vul.cve="CVE-2021-44228"', template: 'vul.cve="${value}"', type: "property", boost: 78 },
  { label: "iconhash", detail: "Match icon hash values", example: 'iconhash="1941681276"', template: 'iconhash="${value}"', type: "property", boost: 62 },
  { label: "filehash", detail: "Match parsed file hash values", example: 'filehash="0b5ce08db7fb8fffe4e14d05588d49d9"', template: 'filehash="${value}"', type: "property", boost: 58 },
  { label: "is_honeypot", detail: "Filter honeypot assets", example: "is_honeypot=true", template: "is_honeypot=true", type: "property", boost: 66 },
  { label: "is_bugbounty", detail: "Filter bug bounty assets", example: "is_bugbounty=true", template: "is_bugbounty=true", type: "property", boost: 60 },
  { label: "bugbounty.source", detail: "Filter bug bounty source", example: 'bugbounty.source="hackerone"', template: 'bugbounty.source="${value}"', type: "property", boost: 54 },
  { label: "is_changed", detail: "Filter assets changed in the last 7 days", example: "is_changed=true", template: "is_changed=true", type: "property", boost: 64 },
  { label: "is_new", detail: "Filter assets newly seen in the last 7 days", example: "is_new=true", template: "is_new=true", type: "property", boost: 64 },
  { label: "&&", detail: "Logical AND", example: 'device="router" && after="2020-01-01"', template: " && ", type: "operator", boost: 90 },
  { label: "||", detail: "Logical OR", example: 'service="ssh" || service="http"', template: " || ", type: "operator", boost: 88 },
  { label: "!=", detail: "Logical NOT / inequality", example: 'country="US" && subdivisions!="new york"', template: "!=", type: "operator", boost: 84 },
  { label: "==", detail: "Exact match (case-sensitive)", example: 'title=="Knownsec"', template: "==", type: "operator", boost: 86 },
  { label: "group", detail: "Insert a grouped expression", example: '(country="US" && port!=80) || title!="404 Not Found"', template: '(${left} && ${right})', type: "keyword", boost: 70 },
  { label: "exact", detail: "Insert an exact-match pattern", example: 'title=="Knownsec"', template: 'title=="${value}"', type: "keyword", boost: 72 },
  { label: "fuzzy", detail: "Insert a fuzzy-match pattern using *", example: 'title="google*"', template: 'title="${prefix}*"', type: "keyword", boost: 72 },
];

const ZOOMEYE_QUERY_LANGUAGE = StreamLanguage.define<{
  inString: "\"" | "'" | null;
  escaped: boolean;
}>({
  startState() {
    return {
      inString: null,
      escaped: false,
    };
  },
  token(stream, state) {
    if (state.inString) {
      while (!stream.eol()) {
        const nextChar = stream.next();
        if (!nextChar) {
          break;
        }

        if (state.escaped) {
          state.escaped = false;
          continue;
        }

        if (nextChar === "\\") {
          state.escaped = true;
          continue;
        }

        if (nextChar === state.inString) {
          state.inString = null;
          break;
        }
      }

      return "string";
    }

    if (stream.eatSpace()) {
      return null;
    }

    const quoted = stream.peek();
    if (quoted === "\"" || quoted === "'") {
      state.inString = stream.next() as "\"" | "'";
      state.escaped = false;
      return "string";
    }

    if (stream.match("&&") || stream.match("||") || stream.match("==") || stream.match("!=")) {
      return "operator";
    }

    if (stream.eat("=")) {
      return "operator";
    }

    if (stream.eat("(") || stream.eat(")")) {
      return "punctuation";
    }

    if (stream.match(/(?:true|false)\b/iu)) {
      return "atom";
    }

    if (stream.match(/\d{4}-\d{2}-\d{2}\b/u) || stream.match(/\d+\b/u)) {
      return "number";
    }

    if (stream.match(/[A-Za-z_][\w.]*/u)) {
      return "propertyName";
    }

    if (stream.match(/\\[()"'\\]/u)) {
      return "escape";
    }

    stream.next();
    return null;
  },
});

const ZOOMEYE_QUERY_HIGHLIGHT_STYLE = HighlightStyle.define([
  { tag: tags.propertyName, color: "#efe1a7" },
  { tag: tags.operatorKeyword, color: "#ffb267" },
  { tag: tags.string, color: "#a6d189" },
  { tag: tags.number, color: "#89b4fa" },
  { tag: tags.bool, color: "#f38ba8" },
  { tag: tags.atom, color: "#f38ba8" },
  { tag: tags.escape, color: "#f9e2af" },
  { tag: tags.punctuation, color: "#cdd6f4" },
]);

const ZOOMEYE_QUERY_EDITOR_THEME = githubDarkInit({
  settings: {
    background: "transparent",
    gutterBackground: "transparent",
    caret: "#ececf2",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
  },
});

const ZOOMEYE_QUERY_THEME = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "#ececf2",
    fontSize: "inherit",
  },
  ".cm-editor": {
    backgroundColor: "transparent",
    color: "#ececf2",
  },
  ".cm-content": {
    caretColor: "#ececf2",
    color: "#ececf2",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
    minHeight: "136px",
    padding: "0",
  },
  ".cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    backgroundColor: "transparent",
    color: "#ececf2",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
    minHeight: "136px",
  },
  ".cm-placeholder": {
    color: "#6f6f78",
  },
  ".cm-gutters": {
    display: "none",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
  },
  ".cm-cursor": {
    borderLeftColor: "#ececf2",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(255, 255, 255, 0.14) !important",
  },
  ".cm-tooltip": {
    backgroundColor: "#111214",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: "12px",
    color: "#ececf2",
    boxShadow: "0 18px 40px rgba(0, 0, 0, 0.35)",
  },
  ".cm-tooltip-autocomplete": {
    backgroundColor: "#111214",
    color: "#ececf2",
  },
  ".cm-tooltip-autocomplete ul": {
    backgroundColor: "#111214",
  },
  ".cm-tooltip-autocomplete ul li": {
    borderRadius: "8px",
    color: "#ececf2",
    padding: "4px 8px",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    color: "#ffffff",
  },
  ".cm-completionIcon": {
    color: "#cfcfd7",
  },
  ".cm-completionLabel": {
    color: "#ececf2",
    fontWeight: "500",
  },
  ".cm-completionDetail": {
    color: "#9b9ba4",
    fontStyle: "normal",
  },
  ".cm-completionMatchedText": {
    color: "#f9d56f",
    textDecoration: "none",
  },
}, { dark: true });

const ZOOMEYE_COMPLETION_OPTIONS = ZOOMEYE_COMPLETION_DEFINITIONS.map((definition) => snippetCompletion(definition.template, {
  label: definition.label,
  detail: definition.detail,
  info: definition.example,
  type: definition.type,
  boost: definition.boost,
}));

function getCompletionWordStart(source: string, position: number): number {
  let index = position;
  while (index > 0 && /[A-Za-z0-9_.-]/u.test(source[index - 1]!)) {
    index -= 1;
  }

  return index;
}

function shouldOpenCompletions(textBeforeCursor: string, currentWord: string, explicit: boolean): boolean {
  if (explicit || currentWord.length > 0) {
    return true;
  }

  const trimmed = textBeforeCursor.trimEnd();
  if (trimmed.length === 0) {
    return true;
  }

  const lastCharacter = trimmed.at(-1);
  return lastCharacter === "(" || lastCharacter === "&" || lastCharacter === "|" || lastCharacter === "=" || lastCharacter === "!";
}

function completeZoomEyeQuery(context: CompletionContext): CompletionResult | null {
  const source = context.state.doc.toString();
  const from = getCompletionWordStart(source, context.pos);
  const currentWord = source.slice(from, context.pos);

  if (!shouldOpenCompletions(source.slice(0, context.pos), currentWord, context.explicit)) {
    return null;
  }

  return {
    from,
    options: ZOOMEYE_COMPLETION_OPTIONS,
    validFor: /[A-Za-z0-9_.-]*/u,
  };
}

const ZOOMEYE_QUERY_BASIC_SETUP = {
  allowMultipleSelections: false,
  autocompletion: true,
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  lineNumbers: false,
} as const;

export function ZoomEyeQueryEditor({
  value,
  onChange,
  onRun,
}: ZoomEyeQueryEditorProps) {
  const extensions = useMemo(() => {
    const result = [
      ZOOMEYE_QUERY_LANGUAGE,
      syntaxHighlighting(ZOOMEYE_QUERY_HIGHLIGHT_STYLE),
      autocompletion({
        activateOnTyping: true,
        defaultKeymap: true,
        override: [completeZoomEyeQuery],
      }),
      placeholder('app="nginx" && country="US"'),
      EditorView.lineWrapping,
      ZOOMEYE_QUERY_THEME,
    ];

    if (onRun) {
      result.push(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              onRun();
              return true;
            },
          },
        ]),
      );
    }

    return result;
  }, [onRun]);

  return (
    <CodeMirror
      className="[&_.cm-editor]:border-0 [&_.cm-editor]:bg-transparent [&_.cm-editor]:outline-none [&_.cm-focused]:outline-none [&_.cm-gutters]:border-0 [&_.cm-gutters]:bg-transparent [&_.cm-scroller]:bg-transparent"
      value={value}
      height="148px"
      basicSetup={ZOOMEYE_QUERY_BASIC_SETUP}
      extensions={extensions}
      onChange={onChange}
      theme={ZOOMEYE_QUERY_EDITOR_THEME}
    />
  );
}