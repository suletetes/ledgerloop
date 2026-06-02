# How to generate AWS architecture diagrams (Diagram-as-Code)

A battle-tested, reusable playbook for creating sharp, professional cloud
architecture diagrams using the Python [`diagrams`](https://github.com/mingrammer/diagrams)
library (a.k.a. *Diagram as Code*). Copy this file into any project.

Everything here is verified against **`diagrams` 0.25.1** and **Graphviz 14.x**.
Where behavior is version-specific, it says so.

> **Mental model:** `diagrams` is a thin Python wrapper that emits a Graphviz
> `dot` graph and renders it. The Python API (`Diagram`, `Cluster`, `Node`,
> `Edge`) is small; nearly all visual control comes from passing **Graphviz
> attributes** through `graph_attr`, `node_attr`, and `edge_attr`. When you want
> to change something and there's no Python parameter for it, reach for the
> [Graphviz attribute reference](https://graphviz.org/doc/info/attrs.html).

---

## Table of contents

1. [Prerequisites](#prerequisites)
2. [Running](#running)
3. [The core API (Diagram, Node, Cluster, Edge)](#the-core-api)
4. [Library defaults you are overriding](#library-defaults)
5. [Settings that produce sharp, readable diagrams](#settings-that-produce-sharp-readable-diagrams)
6. [Landscape vs portrait (and forcing wide)](#landscape-vs-portrait)
7. [Edges: arrows, colors, styles, direction](#edges)
8. [Taming edge spaghetti (less / merged edges)](#taming-edge-spaghetti)
9. [Clusters and nesting](#clusters)
10. [Custom & generic icons (services with no built-in node)](#custom-icons)
11. [Finding the right node + version-safe imports](#finding-nodes)
12. [Full template](#template)
13. [Recipe: splitting a big architecture](#splitting)
14. [Accuracy checklist (does it match reality?)](#accuracy-checklist)
15. [Tips](#tips)
16. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Two pieces: the Python package **and** the Graphviz system binary (the package
shells out to `dot`).

```bash
pip install diagrams
```

Graphviz binary:

- Windows: `winget install Graphviz.Graphviz` then add `C:\Program Files\Graphviz\bin` to PATH
- Mac: `brew install graphviz`
- Linux (Debian/Ubuntu): `apt install graphviz`

Verify both — **this is the #1 source of "it doesn't work":**

```bash
python -c "import diagrams; print('diagrams ok')"
dot -V          # must print a version, e.g. "dot - graphviz version 14.1.5"
```

If `dot -V` fails, the package is installed but rendering will throw. See
[Troubleshooting](#troubleshooting).

---

## Running

```bash
# Windows (if Graphviz isn't on PATH permanently)
$env:Path = $env:Path + ";C:\Program Files\Graphviz\bin"
python docs/generate_architecture.py

# Mac/Linux
python docs/generate_architecture.py
```

Output goes to `docs/` as PNG files. Keep the generator script in source control —
the diagram *is* the code, so diffs are reviewable and regeneration is one command.

---

## The core API

There are only four objects to learn.

### `Diagram` — the canvas

```python
with Diagram(
    name="My App | Architecture",   # also used as the title label
    filename="docs/architecture",   # output path WITHOUT extension
    direction="LR",                 # TB | BT | LR | RL  (default LR)
    curvestyle="curved",            # "ortho" | "curved"  (controls splines)
    outformat="png",                # png | jpg | svg | pdf | dot — or a LIST
    show=False,                     # True opens the image after render
    strict=False,                   # True merges duplicate (multi) edges
    graph_attr={...},
    node_attr={...},
    edge_attr={...},
):
    ...
```

Verified facts (from the 0.25.1 source):

- **`direction`** valid values: `TB`, `BT`, `LR`, `RL`. Invalid values raise `ValueError`.
- **`curvestyle`** valid values: `ortho`, `curved` — this is just a friendly
  alias that sets the Graphviz `splines` attribute. You can also set
  `graph_attr={"splines": "spline"}` directly for true Bézier routing (see
  [Edges](#taming-edge-spaghetti)).
- **`outformat`** valid values: `png`, `jpg`, `svg`, `pdf`, `dot`. It **accepts a
  list** to emit several at once — great for shipping a crisp `svg` for docs and a
  `png` for GitHub previews:
  ```python
  with Diagram("App", outformat=["png", "svg"], show=False):
      ...
  ```
- **`show=False`** is almost always what you want in scripts/CI (don't pop open a
  viewer).
- **`strict=True`** collapses parallel edges between the same two nodes into one.
- **`filename`** must omit the extension; the extension is derived from `outformat`.

> **SVG is underrated.** For READMEs and slide decks, `svg` is infinitely sharp,
> tiny, and text is selectable. Use PNG only where SVG isn't supported.

### `Node` — a single component

A node is `Provider.ResourceType.Name`, e.g. `diagrams.aws.compute.Lambda`.

```python
from diagrams.aws.compute import Lambda
fn = Lambda("Order Processor")
```

`Node(label="", *, nodeid=None, **attrs)` — any extra keyword args are passed
straight through as Graphviz node attributes. Multi-line labels use `\n` (the
library auto-pads node height per newline so the label doesn't overlap the icon):

```python
ddb = DynamoDB("Orders\nSingle-Table")          # two-line label
blank = Node("", shape="plaintext", width="0", height="0")  # invisible spacer
```

### `Cluster` — a labeled group box

```python
with Cluster("Data Layer"):
    ddb = DynamoDB("Primary")
    cache = ElastiCache("Cache")
```

`Cluster(label="cluster", direction="LR", graph_attr=None)`. Clusters can nest to
any depth. See [Clusters](#clusters) for the layout trade-offs.

### `Edge` — a connection

```python
from diagrams import Edge
a >> Edge(label="JWT", color="darkgreen", style="dashed") >> b
```

`Edge(node=None, forward=False, reverse=False, label="", color="", style="", **attrs)`.
`**attrs` passes through any Graphviz edge attribute (`minlen`, `headport`,
`penwidth`, `fontcolor`, …). See [Edges](#edges).

### The connection operators

| Operator | Meaning |
|----------|---------|
| `a >> b` | arrow from `a` to `b` (left-to-right data flow) |
| `a << b` | arrow from `b` to `a` |
| `a - b`  | undirected line (no arrowhead) |

You can chain and fan out with lists:

```python
api >> [fn1, fn2, fn3] >> db          # fan-out then fan-in
lb >> Edge(color="brown") >> primary  # styled connection
```

> **Gotcha:** you cannot connect two lists directly (`[a,b] >> [c,d]` fails —
> Python can't `>>` two lists). Route through a single node or a blank spacer.
> Also mind operator precedence when mixing `-` with `>>`/`<<`; wrap in parens.

---

## Library defaults

`diagrams` ships opinionated defaults. Knowing them tells you what you're actually
changing. These are the **real 0.25.1 defaults**:

```python
# Diagram._default_graph_attrs
{"pad": "2.0", "splines": "ortho", "nodesep": "0.60", "ranksep": "0.75",
 "fontname": "Sans-Serif", "fontsize": "15", "fontcolor": "#2D3436"}

# Diagram._default_node_attrs
{"shape": "box", "style": "rounded", "fixedsize": "true", "width": "1.4",
 "height": "1.4", "labelloc": "b", "imagescale": "true",
 "fontname": "Sans-Serif", "fontsize": "13", "fontcolor": "#2D3436"}

# Diagram._default_edge_attrs
{"color": "#7B8894"}

# Cluster._default_graph_attrs
{"shape": "box", "style": "rounded", "labeljust": "l", "pencolor": "#AEB6BE",
 "fontname": "Sans-Serif", "fontsize": "12"}
```

Notable: default `splines` is **`ortho`** (right-angle), labels sit **below**
icons (`labelloc: b`), nodes are **fixed 1.4×1.4** so very long labels get
clipped — keep labels short or break with `\n`. There is **no `dpi` default**, so
raster output can look soft until you set one (below).

---

## Settings that produce sharp, readable diagrams

Drop-in attribute blocks that match the official AWS reference-architecture look
(compact icons, crisp lines, readable at 100% zoom):

```python
graph_attr = {
    "dpi": "192",           # sharp raster. 150 ok, 192 crisp, 300+ huge files. (ignored for svg)
    "bgcolor": "white",     # use "transparent" to overlay on any page background
    "pad": "0.6",           # outer padding (library default 2.0 is too much)
    "splines": "spline",    # curved routing — cleaner for fan-out than "ortho"
    "ranksep": "1.0",       # gap BETWEEN ranks (columns in LR). bump up to spread
    "nodesep": "0.5",       # gap between nodes in the SAME rank
    "fontname": "Helvetica Neue,Helvetica,Arial,sans-serif",
    "fontsize": "16",       # title font
    "concentrate": "false", # set "true" to merge edges sharing a headport (spline only)
}

node_attr = {
    "fontsize": "11",       # label below each icon. 10-12 reads well
    "fontname": "Helvetica Neue,Helvetica,Arial,sans-serif",
}

edge_attr = {
    "fontsize": "10",       # edge-label size (keep small, they're supplementary)
    "fontname": "Helvetica Neue,Helvetica,Arial,sans-serif",
    "penwidth": "1.4",      # line thickness. 1.2-1.6 looks clean
    "arrowsize": "0.8",     # arrowhead size
    "color": "#444444",     # dark gray, softer than pure black
}
```

Two rules of thumb:

- **`dpi` only affects raster** (`png`/`jpg`). For `svg`/`pdf` it's irrelevant —
  they're vector. If you only ship SVG, skip `dpi` entirely.
- **`ranksep` is your landscape knob** under `LR`, not `nodesep`. See below.

---

## Landscape vs portrait

- `direction="LR"` → flows left-to-right (**landscape**)
- `direction="TB"` → flows top-to-bottom (**portrait**)

`LR` alone is often **not enough**. Diagrams still come out tall when:

1. **Clusters stack vertically.** Each cluster becomes a box; under `LR` boxes
   line up in a row but their *contents* stack, and several clusters of different
   heights produce a tall canvas.
2. **A single rank fans out wide.** One `API Gateway >> [5 Lambdas]` puts 5 nodes
   in one vertical column. The tallest column sets the image height.

### Forcing a wide landscape image

Apply these together:

1. **Drop the clusters** for the flow diagram and let Graphviz arrange nodes
   freely. You lose the grouping boxes but gain a readable wide layout. Label
   groups with code comments instead, or keep clusters only in a separate
   "logical view" diagram.
2. **Spread columns, tighten rows:** raise `ranksep` (horizontal gap between
   columns under LR) and lower `nodesep` (vertical gap within a column).

```python
graph_attr = {
    # ...base settings...
    "splines": "spline",
    "ranksep": "2.5",   # push columns far apart horizontally
    "nodesep": "0.3",   # keep each column short vertically
}
```

> **Don't over-tighten `nodesep`.** Below ~0.25 the arrows between stacked nodes
> share corridors and look merged. ~0.3-0.5 is the sweet spot when using curved
> splines.

Aim for a width:height ratio above **~1.3**. Quick check (pure stdlib, reads the
PNG header):

```python
import struct
d = open("docs/diagram.png", "rb").read(26)
w, h = struct.unpack(">II", d[16:24])
print(w, "x", h, "ratio %.2f" % (w / h))
```

A ratio below 1.0 is portrait (text shrinks when embedded); above 1.3 reads well
in a README. **SVG sidesteps this** — it's resolution-independent, so a slightly
tall SVG still renders text crisply.

---

## Edges

An `Edge` mirrors three Graphviz attributes plus anything else you pass:

```python
from diagrams import Edge

# Solid dark arrow (primary request path)
a >> Edge(color="#333333") >> b

# Dashed gray arrow (secondary / async / background flow)
a >> Edge(color="#888888", style="dashed") >> b

# Red dashed arrow (error / failover path)
a >> Edge(color="#cc0000", style="dashed") >> b

# Bold emphasis
a >> Edge(color="#333333", style="bold") >> b

# Labeled
a >> Edge(color="#333333", label="JWT") >> b

# Undirected association (no arrowhead) — great for replicas / peers
primary - Edge(color="brown", style="dashed") - replica
```

Common `style` values (Graphviz): `solid`, `dashed`, `dotted`, `bold`, `invis`
(invisible — useful for forcing layout without drawing a line).

A consistent **color legend** makes diagrams self-documenting. Pick 2-4 and stick
to them across every diagram in a project. Example legend that scales well:

| Color | Meaning |
|-------|---------|
| `#333333` solid | primary synchronous request path |
| `#888888` dashed | async / background / optional flow |
| `#cc0000` dashed | error / failover / DLQ path |
| `#10B981` (brand green) | security / data-protection flow |

Rules:
- Solid = main path, dashed = async/optional, red = error/failover.
- Keep labels to 1-2 words; don't label edges whose meaning is obvious from context.
- `>>` / `<<` choose arrow direction; `-` for peer relationships.

---

## Taming edge spaghetti

When you have many cross-cutting edges, the diagram gets noisy. Three proven
techniques (straight from the official Edge guide):

### 1. Route through a blank spacer node

Create an invisible node and fan everything through it, so you draw *one* edge
into a cluster instead of N:

```python
from diagrams import Node
blank = Node("", shape="plaintext", width="0", height="0")
ingress >> server >> blank
blank >> [sessions, database, aggregator]   # one hop, not many crossings
```

### 2. Merge edges with `concentrate`

```python
graph_attr = {"concentrate": "true", "splines": "spline"}
```

Restrictions (important — it silently no-ops otherwise):
1. Edges must end at the **same headport**.
2. Only works when **`splines` is `spline`** (NOT the library default `ortho`).
3. Only with the `dot` layout engine (the library default).

### 3. Fan-out with lists

Connecting to a Python list draws all edges in one statement and lets Graphviz
balance them:

```python
api >> [fn_auth, fn_orders, fn_billing] >> dynamodb
```

> **Arrows look merged into one line?** That's `splines: "ortho"` collapsing
> parallel right-angle segments into shared corridors on fan-out. Switch to
> `splines: "spline"` (curved) so each edge routes as its own curve, and keep
> `nodesep` ≥ 0.3.

---

## Clusters

`Cluster` groups nodes in a labeled rounded box. Connect nodes inside a cluster to
nodes outside it freely.

```python
from diagrams import Cluster, Diagram
from diagrams.aws.compute import ECS
from diagrams.aws.database import RDS
from diagrams.aws.network import Route53

with Diagram("Web Service with DB Cluster", show=False):
    dns = Route53("dns")
    web = ECS("service")
    with Cluster("DB Cluster"):
        primary = RDS("primary")
        primary - [RDS("replica1"), RDS("replica2")]
    dns >> web >> primary
```

**Nesting** has no depth limit:

```python
with Cluster("Event Flows"):
    with Cluster("Workers"):
        workers = [ECS("w1"), ECS("w2"), ECS("w3")]
    queue = SQS("queue")
    with Cluster("Processing"):
        handlers = [Lambda("p1"), Lambda("p2"), Lambda("p3")]
```

Trade-offs:
- Keep clusters **small (2-4 nodes)**. Big clusters get tall and fight landscape.
- Style a cluster via `graph_attr`, e.g. tint the background:
  ```python
  with Cluster("Secure Zone", graph_attr={"bgcolor": "#F0FFF4"}):
      ...
  ```
- For wide flow diagrams, prefer **no clusters**; reserve clusters for a separate
  "logical grouping" view. (See [Landscape](#landscape-vs-portrait).)

---

## Custom icons

Two escape hatches when a service has no built-in node.

### `Custom` — your own image (PNG/SVG icon)

```python
from diagrams.custom import Custom
paystack = Custom("Paystack", "./icons/paystack.png")
api >> paystack
```

`Custom(label, icon_path, *args, **kwargs)`. Point `icon_path` at a local image.
This is the right call for third-party SaaS (Stripe, Paystack, Twilio) or
brand-new AWS services the library hasn't added yet. Keep a small `./icons/`
folder of 64-128px PNGs in the repo.

### Generic / blank nodes

For an unbranded box, use the generic provider or a plain `Node`:

```python
from diagrams.generic.blank import Blank
from diagrams.aws.general import General      # the AWS "general" cube
External = General("3rd-Party API")
```

---

## Finding nodes

The library ships **22 providers**, each split into resource categories.
Installed providers (0.25.1):

```
alibabacloud, aws, azure, base, c4, cli, custom, digitalocean, elastic,
firebase, gcp, generic, gis, ibm, k8s, oci, onprem, openstack, outscale,
programming, saas
```

AWS resource categories:

```
analytics, ar, blockchain, business, compute, cost, database, devtools,
enablement, enduser, engagement, game, general, integration, iot,
management, media, migration, ml, mobile, network, quantum, robotics,
satellite, security, storage
```

Browse the full visual catalog at
<https://diagrams.mingrammer.com/docs/nodes/aws>. To list what an installed
module actually exports (the reliable way), introspect it:

```bash
python -c "import diagrams.aws.compute as m; print([x for x in dir(m) if not x.startswith('_')])"
```

### Version-safe imports (class names drift between releases)

Node class names are **not stable** across `diagrams` versions — they get renamed.
The classic trap: `DynamoDB` in older docs is `Dynamodb` in some installed
versions. When you hit `ImportError: cannot import name 'X'`:

```bash
# See what THIS install actually has:
python -c "import diagrams.aws.database as m; print([x for x in dir(m) if not x.startswith('_')])"
```

Then alias it so the rest of your script stays stable:

```python
from diagrams.aws.database import Dynamodb as DynamoDB   # keep code version-agnostic
```

For nodes that only exist in newer releases (e.g. `Bedrock`), guard with a
fallback so the script still runs on older installs:

```python
try:
    from diagrams.aws.ml import Bedrock
except ImportError:
    from diagrams.aws.ml import MachineLearning as Bedrock

try:
    from diagrams.aws.iot import IotCore
except ImportError:
    from diagrams.aws.general import General as IotCore
```

> Some services genuinely have **no icon** in a given version (e.g. Amazon
> Location Service in 0.25.1). Use `General(...)` with a descriptive label or a
> `Custom(...)` icon rather than mislabeling another service's icon.

### Common AWS imports (reference)

```python
from diagrams.aws.compute import Lambda, ECS, EC2, Fargate
from diagrams.aws.network import CloudFront, Route53, APIGateway, ELB, VPC, NATGateway
from diagrams.aws.database import RDS, Aurora, Dynamodb, ElastiCache, Timestream
from diagrams.aws.storage import S3, EFS
from diagrams.aws.security import WAF, Cognito, SecretsManager, KMS, IAMRole, Shield
from diagrams.aws.management import Cloudwatch, SystemsManager
from diagrams.aws.integration import SQS, SNS, Eventbridge, StepFunctions
from diagrams.aws.ml import Sagemaker, Bedrock
from diagrams.aws.iot import IotCore
from diagrams.aws.engagement import SES
from diagrams.aws.general import Users, General
from diagrams.aws.devtools import Codebuild, Codepipeline
```

---

## Template

A complete, copy-paste starting point with the conventions above baked in:

```python
"""Architecture diagram generator. Run: python docs/generate_architecture.py"""
from diagrams import Cluster, Diagram, Edge, Node
from diagrams.aws.compute import Lambda
from diagrams.aws.network import CloudFront, APIGateway
from diagrams.aws.database import Dynamodb as DynamoDB
from diagrams.aws.storage import S3
from diagrams.aws.general import Users, General

GRAPH_ATTR = {
    "dpi": "192",
    "bgcolor": "white",
    "pad": "0.6",
    "splines": "spline",
    "ranksep": "1.4",
    "nodesep": "0.5",
    "fontname": "Helvetica Neue,Helvetica,Arial,sans-serif",
    "fontsize": "16",
}
NODE_ATTR = {"fontsize": "11", "fontname": "Helvetica Neue,Helvetica,Arial,sans-serif"}
EDGE_ATTR = {
    "fontsize": "10", "fontname": "Helvetica Neue,Helvetica,Arial,sans-serif",
    "penwidth": "1.4", "arrowsize": "0.8", "color": "#444444",
}

# Consistent edge-color legend
SOLID, ASYNC, ERROR, SECURE = "#333333", "#888888", "#cc0000", "#10B981"

with Diagram(
    "My App | Architecture",
    filename="docs/architecture",
    outformat=["png", "svg"],   # crisp svg for docs + png for GitHub
    show=False,
    direction="LR",
    graph_attr=GRAPH_ATTR,
    node_attr=NODE_ATTR,
    edge_attr=EDGE_ATTR,
):
    users = Users("Users")

    # Edge tier
    cdn = CloudFront("CloudFront")
    api = APIGateway("API Gateway")
    assets = S3("Static Assets")

    # Compute
    fn = Lambda("App Service")

    # Data
    db = DynamoDB("Primary\nSingle-Table")

    # Third-party (no built-in node) -> General or Custom
    payments = General("Paystack\n(Payments)")

    users >> Edge(color=SOLID) >> cdn >> Edge(color=ASYNC, style="dashed", label="cache") >> assets
    users >> Edge(color=SOLID) >> api >> Edge(color=SOLID) >> fn >> Edge(color=SOLID) >> db
    fn >> Edge(color=ASYNC, style="dashed", label="charge") >> payments
```

---

## Splitting

A single canvas with 20+ nodes never lays out cleanly. Split it. Rule of thumb:
split when **any** of these is true —

- More than ~15 nodes.
- You're mixing request flow with operational concerns (security, monitoring).
- The layout engine can't produce a clean result no matter the spacing.

Good axis to split on:

- **Diagram 1 — Request flow:** client → edge → API → compute → data (synchronous).
- **Diagram 2 — Async/eventing:** events, queues, IoT ingestion, schedulers, AI/ML.
- **Diagram 3 — Operations:** security layers, networking, monitoring, DR.

Keep **shared conventions** (same colors, same node labels, same style blocks)
across all splits so they read as one system. Factor `GRAPH_ATTR`/`NODE_ATTR`/
`EDGE_ATTR` and the color constants into module-level globals and reuse them in
each diagram function.

> Beware: a node that fans out (one API → many Lambdas) belongs in the flow
> diagram with a visible trigger. A node drawn with **no inbound edge** reads as
> "magic" — always show what invokes each component, even in the async view.

---

## Accuracy checklist

A pretty diagram that lies is worse than no diagram. Before you ship, reconcile
against your **source of truth** (IaC template, design doc):

- [ ] Every provisioned service that matters appears in at least one diagram.
- [ ] No service is drawn that isn't actually deployed.
- [ ] Every node has an inbound edge (or is an obvious entry point like Users).
- [ ] Synchronous vs async flows use the agreed edge styles consistently.
- [ ] Multi-layer concepts (e.g. defense-in-depth layers) show **all** layers, in
      order — no gaps in numbering.
- [ ] Labels match real resource roles, not a similar service's icon used as a stand-in.
- [ ] If you split into multiple diagrams, the union covers the whole system.

Cross-check programmatically when you can — e.g. grep the IaC template for
resource types and confirm each has a node.

---

## Tips

1. Fewer nodes is better. 20+ services → split into multiple diagrams.
2. Don't label every edge. Cluster + node names usually make flow obvious.
3. Use a consistent 2-4 color legend across every diagram in the project.
4. Keep node labels 1-2 words. "API Gateway", not "Amazon API Gateway HTTP API v2".
5. Break long labels with `\n`; nodes are fixed-size and will clip otherwise.
6. Ship **SVG** for docs (sharp, tiny, selectable text); PNG only where required.
7. For PNG README embeds, target 150-192 DPI at ~2000-3000px wide.
8. Commit the generator script; treat diagrams as reviewable code, not binaries.
9. Factor style blocks into globals so all diagrams in a repo stay consistent.

---

## Troubleshooting

**`dot` is not recognized / `ExecutableNotFound`**
Graphviz binary isn't on PATH. Add `C:\Program Files\Graphviz\bin` to system PATH,
or prefix for the session:
```powershell
$env:Path = $env:Path + ";C:\Program Files\Graphviz\bin"
```
On Mac/Linux, reinstall via `brew install graphviz` / `apt install graphviz`.

**`ImportError: cannot import name 'DynamoDB'` (or another node)**
Class names changed between `diagrams` versions. List what's actually exported
(`python -c "import diagrams.aws.database as m; print(dir(m))"`) and alias it
(`from diagrams.aws.database import Dynamodb as DynamoDB`). See
[version-safe imports](#finding-nodes).

**Diagram is portrait when you want landscape**
Use `direction="LR"`, remove clusters, push `ranksep` up (e.g. `2.5`) and
`nodesep` down (e.g. `0.3`). See [Forcing a wide landscape image](#landscape-vs-portrait).

**Arrows are messy/crossing or look merged into one line**
`splines: "ortho"` (the library default) collapses parallel segments into shared
corridors on fan-out. Switch to `splines: "spline"` (curved) so each edge routes
separately; keep `nodesep` ≥ 0.3. For deliberate merging use `concentrate: "true"`
(spline-only, same-headport). See [Taming edge spaghetti](#taming-edge-spaghetti).

**Labels overlap icons**
Labels sit below icons (`labelloc: b`). If they collide with the next node,
`nodesep` is too small — raise it to 0.5-0.8. Long labels clip because nodes are
fixed 1.4×1.4; shorten or split with `\n`.

**Image is blurry**
Raster only: set `dpi` to 150-192. (SVG/PDF are vector — `dpi` does nothing; just
use SVG for perfect sharpness.)

**Image is huge (5MB+)**
Lower `dpi` to ~150, reduce node count, or switch to SVG. Splitting into multiple
diagrams also shrinks each file.

**`concentrate: "true"` did nothing**
It only works with `splines: "spline"` (not `ortho`), the `dot` engine (default),
and when edges share the same headport. Otherwise it silently no-ops.

**Two lists won't connect (`[a,b] >> [c,d]` errors)**
Python can't apply `>>` to two lists. Route through a single node or an invisible
`Node("", shape="plaintext", width="0", height="0")` spacer.

**Background is white but I want it transparent**
Set `graph_attr={"bgcolor": "transparent"}` so the diagram overlays cleanly on
dark or themed pages.

---

*Sources: [diagrams docs](https://diagrams.mingrammer.com/docs/getting-started/installation),
[Graphviz attribute reference](https://graphviz.org/doc/info/attrs.html), and direct
introspection of the installed `diagrams` 0.25.1 source. Content paraphrased and
verified for accuracy.*
