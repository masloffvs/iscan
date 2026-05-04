export type WorkspaceFile = {
  id: string;
  label: string;
  kind: "notebook" | "script" | "data";
  cells: number;
  status: string;
  summary: string;
};

export type NotebookCellKind = "markdown" | "code" | "sql";

export type NotebookCell = {
  id: string;
  kind: NotebookCellKind;
  title: string;
  language?: string;
  executionCount?: number;
  source: string[];
  output?: string[];
};

export type NotebookDocument = {
  id: string;
  title: string;
  path: string;
  kernel: string;
  trusted: boolean;
  summary: string;
  cells: NotebookCell[];
};

export type WorkspaceTreeNode = {
  id: string;
  label: string;
  kind: "folder" | "file";
  fileId?: string;
  children?: WorkspaceTreeNode[];
};

export const kernelProfiles = [
  {
    id: "obsidian",
    label: "Obsidian",
    note: "Tight contrast, low noise, heavy panels.",
  },
  {
    id: "graphite",
    label: "Graphite",
    note: "Softer carbon layers for longer sessions.",
  },
  {
    id: "terminal",
    label: "Terminal",
    note: "Sharper signal accents and denser grid lines.",
  },
] as const;

export const workspaceFiles: WorkspaceFile[] = [
  {
    id: "workspace/recon.ipynb",
    label: "recon.ipynb",
    kind: "notebook",
    cells: 4,
    status: "trusted",
    summary: "Primary reconnaissance workbook",
  },
  {
    id: "workspace/enrichment.ipynb",
    label: "enrichment.ipynb",
    kind: "notebook",
    cells: 4,
    status: "draft",
    summary: "Domain enrichment and joins",
  },
  {
    id: "workspace/radar.ipynb",
    label: "radar.ipynb",
    kind: "notebook",
    cells: 3,
    status: "trusted",
    summary: "Cloudflare Radar pulls",
  },
  {
    id: "workspace/temp-mail.ipynb",
    label: "temp-mail.ipynb",
    kind: "notebook",
    cells: 3,
    status: "live",
    summary: "Inbox watch and parsing",
  },
  {
    id: "workspace/scratchpad.ipynb",
    label: "scratchpad.ipynb",
    kind: "notebook",
    cells: 2,
    status: "new",
    summary: "Loose checks and ad-hoc snippets",
  },
];

export const workspaceTree: WorkspaceTreeNode[] = [
  {
    id: "tree-workspace",
    label: "workspace",
    kind: "folder",
    children: [
      {
        id: "tree-investigations",
        label: "investigations",
        kind: "folder",
        children: [
          { id: "node-recon", label: "recon.ipynb", kind: "file", fileId: "workspace/recon.ipynb" },
          { id: "node-enrichment", label: "enrichment.ipynb", kind: "file", fileId: "workspace/enrichment.ipynb" },
        ],
      },
      {
        id: "tree-monitoring",
        label: "monitoring",
        kind: "folder",
        children: [
          { id: "node-radar", label: "radar.ipynb", kind: "file", fileId: "workspace/radar.ipynb" },
          { id: "node-temp-mail", label: "temp-mail.ipynb", kind: "file", fileId: "workspace/temp-mail.ipynb" },
        ],
      },
      {
        id: "tree-drafts",
        label: "drafts",
        kind: "folder",
        children: [
          { id: "node-scratchpad", label: "scratchpad.ipynb", kind: "file", fileId: "workspace/scratchpad.ipynb" },
        ],
      },
    ],
  },
];

export const notebookDocuments: Record<string, NotebookDocument> = {
  "workspace/recon.ipynb": {
    id: "workspace/recon.ipynb",
    title: "Recon Notebook",
    path: "workspace/recon.ipynb",
    kernel: "Python 3.12",
    trusted: true,
    summary: "Initial host census, tagging, and network notes.",
    cells: [
      {
        id: "recon-intro",
        kind: "markdown",
        title: "Scope",
        source: [
          "# Recon Sprint",
          "Track live targets, notes, and pivots for the current workspace.",
          "Priorities: fingerprint entrypoints, cluster by ASN, push suspicious domains into enrichment.",
        ],
      },
      {
        id: "recon-load",
        kind: "code",
        title: "Load Target Frame",
        language: "python",
        executionCount: 7,
        source: [
          "import pandas as pd",
          "targets = pd.DataFrame([",
          "    {\"host\": \"alpha.internal\", \"asn\": \"AS13335\", \"risk\": 82},",
          "    {\"host\": \"mail-drop.gateway\", \"asn\": \"AS16509\", \"risk\": 74},",
          "    {\"host\": \"origin.edge-shadow\", \"asn\": \"AS15169\", \"risk\": 67},",
          "])",
          "targets.sort_values(\"risk\", ascending=False)",
        ],
        output: [
          "host               asn      risk",
          "alpha.internal     AS13335  82",
          "mail-drop.gateway  AS16509  74",
          "origin.edge-shadow AS15169  67",
        ],
      },
      {
        id: "recon-notes",
        kind: "markdown",
        title: "Notes",
        source: [
          "## Operator Notes",
          "- `alpha.internal` is still the cleanest entry node.",
          "- `mail-drop.gateway` should be mirrored into the temp-mail notebook.",
        ],
      },
      {
        id: "recon-cluster",
        kind: "code",
        title: "Cluster by ASN",
        language: "python",
        executionCount: 11,
        source: [
          "summary = targets.groupby(\"asn\").agg(count=(\"host\", \"count\"), max_risk=(\"risk\", \"max\"))",
          "summary",
        ],
        output: [
          "asn      count  max_risk",
          "AS13335  1      82",
          "AS15169  1      67",
          "AS16509  1      74",
        ],
      },
    ],
  },
  "workspace/enrichment.ipynb": {
    id: "workspace/enrichment.ipynb",
    title: "Enrichment Notebook",
    path: "workspace/enrichment.ipynb",
    kernel: "Python 3.12",
    trusted: false,
    summary: "Joins domains with tags, ownership, and observed signals.",
    cells: [
      {
        id: "enrichment-brief",
        kind: "markdown",
        title: "Brief",
        source: [
          "# Enrichment",
          "Merge reconnaissance output with attribution and contact hints before export.",
        ],
      },
      {
        id: "enrichment-merge",
        kind: "code",
        title: "Join Signals",
        language: "python",
        executionCount: 3,
        source: [
          "enriched = targets.assign(owner=[\"Cloudflare\", \"AWS\", \"Google\"], tier=[\"hot\", \"watch\", \"warm\"])",
          "enriched[[\"host\", \"owner\", \"tier\"]]",
        ],
        output: [
          "host               owner       tier",
          "alpha.internal     Cloudflare  hot",
          "mail-drop.gateway  AWS         watch",
          "origin.edge-shadow Google      warm",
        ],
      },
      {
        id: "enrichment-tags",
        kind: "code",
        title: "Tag Priority",
        language: "python",
        executionCount: 4,
        source: [
          "priority = enriched.groupby(\"tier\").size()",
          "priority",
        ],
        output: [
          "tier",
          "hot      1",
          "warm     1",
          "watch    1",
        ],
      },
      {
        id: "enrichment-close",
        kind: "markdown",
        title: "Export",
        source: [
          "## Export Plan",
          "Push `hot` rows into the next active review queue and keep `watch` in the notebook until attribution stabilizes.",
        ],
      },
    ],
  },
  "workspace/radar.ipynb": {
    id: "workspace/radar.ipynb",
    title: "Radar Notebook",
    path: "workspace/radar.ipynb",
    kernel: "Python 3.12",
    trusted: true,
    summary: "Snapshot Radar pulls and domain volatility notes.",
    cells: [
      {
        id: "radar-intro",
        kind: "markdown",
        title: "Radar Context",
        source: [
          "# Radar Pulls",
          "Use this notebook for ranking shifts and DNS volatility before deeper capture.",
        ],
      },
      {
        id: "radar-fetch",
        kind: "code",
        title: "Top Domains",
        language: "python",
        executionCount: 5,
        source: [
          "top_domains = [\"example-one.test\", \"example-two.test\", \"example-three.test\"]",
          "top_domains",
        ],
        output: [
          "['example-one.test', 'example-two.test', 'example-three.test']",
        ],
      },
      {
        id: "radar-todo",
        kind: "markdown",
        title: "Follow-ups",
        source: [
          "## Follow-ups",
          "- Compare top three domains against enrichment tiering.",
          "- Promote any overlap into recon tags.",
        ],
      },
    ],
  },
  "workspace/temp-mail.ipynb": {
    id: "workspace/temp-mail.ipynb",
    title: "Temp Mail Notebook",
    path: "workspace/temp-mail.ipynb",
    kernel: "Python 3.12",
    trusted: true,
    summary: "Monitor inbox events and extract follow-up pivots.",
    cells: [
      {
        id: "temp-mail-brief",
        kind: "markdown",
        title: "Brief",
        source: [
          "# Inbox Watch",
          "Track disposable inbox activity and flag any subject line that maps back to recon targets.",
        ],
      },
      {
        id: "temp-mail-fetch",
        kind: "code",
        title: "Recent Messages",
        language: "python",
        executionCount: 8,
        source: [
          "messages = [",
          "    {\"subject\": \"Verify account\", \"domain\": \"mail-drop.gateway\"},",
          "    {\"subject\": \"Reset token\", \"domain\": \"alpha.internal\"},",
          "]",
          "messages",
        ],
        output: [
          "[{'subject': 'Verify account', 'domain': 'mail-drop.gateway'}, {'subject': 'Reset token', 'domain': 'alpha.internal'}]",
        ],
      },
      {
        id: "temp-mail-next",
        kind: "markdown",
        title: "Next Step",
        source: [
          "## Next Step",
          "Push any repeated subject patterns into enrichment tags and keep a mirror row in recon notes.",
        ],
      },
    ],
  },
  "workspace/scratchpad.ipynb": {
    id: "workspace/scratchpad.ipynb",
    title: "Scratchpad",
    path: "workspace/scratchpad.ipynb",
    kernel: "Python 3.12",
    trusted: false,
    summary: "Fast temporary snippets and one-off checks.",
    cells: [
      {
        id: "scratchpad-note",
        kind: "markdown",
        title: "Scratch",
        source: [
          "# Scratchpad",
          "Keep one-off snippets here before moving them into a stable notebook.",
        ],
      },
      {
        id: "scratchpad-code",
        kind: "code",
        title: "Quick Check",
        language: "python",
        executionCount: 1,
        source: [
          "sum([82, 74, 67]) / 3",
        ],
        output: [
          "74.33333333333333",
        ],
      },
    ],
  },
};

export function getDefaultNotebook(): NotebookDocument {
  const notebook = notebookDocuments["workspace/recon.ipynb"];
  if (!notebook) {
    throw new Error("Missing default notebook.");
  }
  return notebook;
}

export function getFileById(fileId: string): WorkspaceFile | undefined {
  return workspaceFiles.find((file) => file.id === fileId);
}
