#!/usr/bin/env python3
"""Generate the K-DHT / G-DHT / Axona 3-protocol chart for the pitch deck.

Reads the canonical 25K benchmark CSV (v0.93.0, May 2026) and produces:

  C_3way_axona_25k.svg   — 5-cell × 3-protocol grouped bar chart with the
                           Dabek 3-delta analytical floor as a reference line

Run:  python3 generate_3way_axona.py
"""

import sys
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt

sys.path.insert(0, str(Path(__file__).parent))
from style import apply_base_style, style_axes, figsize_wide, legend


HERE   = Path(__file__).parent
OUT    = HERE
CSV    = (HERE.parent.parent / "programmer-guide" / "benchmarks-25k"
          / "2026-05-21_25k_5protocols_5tests_v0.93.0.csv")

# Restrained colour palette — match the existing deck style module
KADEMLIA = "#9aa0a6"     # muted neutral grey
G_DHT    = "#6fa8a8"     # mid teal
AXONA    = "#2d7373"     # rust-leaning dark teal (matches pitch .num accent)
FLOOR    = "#c0392b"     # rust accent for the floor reference line


def parse_axona_csv(path):
    """Return {protocol: {cell: ms}} from the 5-protocol v0.93.0 CSV."""
    text = Path(path).read_text()
    # First non-comment line is the header
    lines = [ln for ln in text.splitlines() if ln and not ln.startswith("#")]
    header = lines[0].split(",")
    # Find the *ms columns we care about
    cells_in = ["global", "500km", "2000km", "5000km", "5%churn"]
    cells_out = ["Global", "500 km", "2000 km", "5000 km", "5 % churn"]
    col_index = {}
    for cell in cells_in:
        col_index[cell] = header.index(f"{cell} ms")

    data = {}
    for row in lines[1:]:
        parts = row.split(",")
        proto = parts[0].strip()
        if proto in ("Kademlia", "G-DHT", "Axona"):
            data[proto] = {cells_out[i]: float(parts[col_index[c]])
                           for i, c in enumerate(cells_in)}
    return data, cells_out


def chart_3way():
    data, cells = parse_axona_csv(CSV)
    apply_base_style()

    # Wide, flat aspect tuned for the pitch slide layout — must fit
    # below ~3 short bullets in the .main column of slide 6.
    fig, ax = plt.subplots(figsize=(12, 3.0))
    x = np.arange(len(cells))
    w = 0.27

    kad   = [data["Kademlia"][c] for c in cells]
    gdht  = [data["G-DHT"][c]    for c in cells]
    axona = [data["Axona"][c]    for c in cells]

    ax.bar(x - w, kad,   w, label="K-DHT (Kademlia baseline)", color=KADEMLIA)
    ax.bar(x,     gdht,  w, label="G-DHT (geographic prefix)", color=G_DHT)
    ax.bar(x + w, axona, w, label="Axona (neuromorphic)",       color=AXONA)

    # Value labels on each bar
    for i, (k, g, a) in enumerate(zip(kad, gdht, axona)):
        ax.text(i - w, k + 12, f"{k:.0f}", ha="center", fontsize=9, color="#333")
        ax.text(i,     g + 12, f"{g:.0f}", ha="center", fontsize=9, color="#333")
        ax.text(i + w, a + 12, f"{a:.0f}", ha="center", fontsize=9, color="#333",
                fontweight="bold")

    # Dabek 3-delta floor reference line (204 ms at this population, median delta = 68 ms)
    floor_ms = 204
    ax.axhline(floor_ms, color=FLOOR, linewidth=0.9, linestyle="--", alpha=0.7)
    ax.text(-0.45, floor_ms + 18,
            f"Dabek 3δ floor  ·  {floor_ms} ms",
            ha="left", fontsize=9, color=FLOOR, style="italic")

    ax.set_xticks(x)
    ax.set_xticklabels(cells)
    ax.set_ylabel("Simulated lookup latency (ms)")
    ax.set_title("Lookup latency by cell — 25,000 nodes  ·  100 % success across every cell  ·  May 2026, sim v0.93.0",
                 pad=22)
    ymax = max(max(kad), max(gdht), max(axona))
    # Extra headroom so the legend (placed above the bars, below the title)
    # doesn't collide with the tall K-DHT / G-DHT bars on the 5 % churn cell.
    ax.set_ylim(0, ymax * 1.32)

    legend(ax, loc="upper center", bbox_to_anchor=(0.5, 1.0),
           ncol=3, frameon=False)
    style_axes(ax)

    out_svg = OUT / "C_3way_axona_25k.svg"
    out_png = OUT / "C_3way_axona_25k.png"
    fig.savefig(out_svg, bbox_inches="tight")
    fig.savefig(out_png, bbox_inches="tight", dpi=180)
    plt.close(fig)
    print(f"wrote {out_svg}")
    print(f"wrote {out_png}")


if __name__ == "__main__":
    chart_3way()
