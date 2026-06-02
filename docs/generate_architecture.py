"""
LedgerLoop architecture diagram generator.

Run:
    pip install diagrams
    # Windows: $env:Path = $env:Path + ";C:\\Program Files\\Graphviz\\bin"
    python docs/generate_architecture.py

Output: docs/ledgerloop_architecture.png + docs/ledgerloop_architecture.svg
"""
from diagrams import Cluster, Diagram, Edge, Node
from diagrams.aws.database import Aurora
from diagrams.aws.management import Cloudwatch
from diagrams.aws.security import IAMRole
from diagrams.aws.general import Users
from diagrams.aws.network import CloudFront

# Try importing newer node names, fall back gracefully
try:
    from diagrams.aws.compute import Lambda
except ImportError:
    from diagrams.aws.compute import Lambda

# Vercel has no built-in node — use a generic or custom
from diagrams.generic.compute import Rack as Vercel
from diagrams.programming.framework import React

# ─── Style blocks (reused across all diagrams) ────────────────────────────

GRAPH_ATTR = {
    "dpi": "192",
    "bgcolor": "white",
    "pad": "0.6",
    "splines": "spline",
    "ranksep": "1.6",
    "nodesep": "0.5",
    "fontname": "Helvetica Neue,Helvetica,Arial,sans-serif",
    "fontsize": "16",
}
NODE_ATTR = {
    "fontsize": "11",
    "fontname": "Helvetica Neue,Helvetica,Arial,sans-serif",
}
EDGE_ATTR = {
    "fontsize": "10",
    "fontname": "Helvetica Neue,Helvetica,Arial,sans-serif",
    "penwidth": "1.4",
    "arrowsize": "0.8",
    "color": "#444444",
}

# Edge color legend
SOLID = "#333333"       # primary synchronous path
ASYNC = "#888888"       # async / background
ERROR = "#cc0000"       # error / failover
SECURE = "#10B981"      # security / auth flow

# ─── Diagram 1: Request flow ──────────────────────────────────────────────

with Diagram(
    "LedgerLoop | Request Flow",
    filename="docs/ledgerloop_architecture",
    outformat="png",
    show=False,
    direction="LR",
    graph_attr=GRAPH_ATTR,
    node_attr=NODE_ATTR,
    edge_attr=EDGE_ATTR,
):
    users = Users("Members\n(Lagos/London/Toronto)")

    with Cluster("Vercel", graph_attr={"bgcolor": "#F8FAFC"}):
        nextjs = React("Next.js\nApp Router")

        with Cluster("Ledger Service"):
            auth = IAMRole("Auth Guard")
            split_calc = Lambda("Split\nCalculator")
            balance = Lambda("Balance\nEngine")
            simplifier = Lambda("Debt\nSimplifier")

    with Cluster("Aurora DSQL", graph_attr={"bgcolor": "#FFF7ED"}):
        dsql = Aurora("Append-Only\nLedger")

    cloudwatch = Cloudwatch("CloudWatch\nMetrics")

    # Request flow
    users >> Edge(color=SOLID, label="HTTPS") >> nextjs
    nextjs >> Edge(color=SECURE, label="session") >> auth
    auth >> Edge(color=SOLID) >> split_calc
    auth >> Edge(color=SOLID) >> balance
    auth >> Edge(color=SOLID) >> simplifier
    split_calc >> Edge(color=SOLID, label="atomic\ninsert") >> dsql
    balance >> Edge(color=ASYNC, style="dashed", label="derive") >> dsql
    simplifier >> Edge(color=ASYNC, style="dashed") >> balance

    # OCC retry (the concurrency story)
    dsql >> Edge(color=ERROR, style="dashed", label="40001\nretry") >> split_calc

    # Observability
    dsql >> Edge(color=ASYNC, style="dashed", label="DPU\nmetrics") >> cloudwatch


print("Done. Output: docs/ledgerloop_architecture.png")
