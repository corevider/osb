#!/usr/bin/env python3
"""Convert third-party navigation data into the lean long-range route graph.

Source: third-party navigation data (do not publish without the
user's approval). The format was established here and is checked on every run:

    zlib stream
    uint32 count
    count * 12 bytes: <f32 x, f32 z, i16 height, u16 flag>
    count * (u8 degree + degree * u32 point index)

An edge is stored once, at one of its two endpoints; symmetrising the lists
gives the walkable graph. Every point must be consumed exactly and the last
byte must end the file.

The source coordinates are the classic Silkroad display metres. OpenSRO's internal
absolute units are:

    X = display_x * 10 + 259200   (135 sectors * 192 m)
    Z = display_z * 10 + 176640   (92 sectors * 192 m)

The converter coarsens the graph onto square cells (the finest cell size that
keeps each output below the size limit) by contracting cell-internal edges.
Contraction preserves connectivity. Output is NVL1:

    'NVL1' u8 version u8 flags u16 reserved
    i32 originX i32 originZ u32 count u32 arcs
    count * <i16 gx, i16 gz, i16 height>   (grid steps of 10 internal units)
    (count + 1) * u32 offsets
    arcs * u16 neighbour index

The game's own collision window still does every local step and the final
walk; this graph only chooses the long-range corridor.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import zlib
import glob
import os
from collections import Counter, defaultdict

ORIGIN_X = 135 * 192
ORIGIN_Z = 92 * 192
DUNGEONS = {"nav20", "nav52"}
CELL_CANDIDATES = (12.8, 16.0, 19.2, 22.4, 25.6, 32.0)
SIZE_LIMIT = 450_000
MAX_EDGE = 23.5           # display metres; real maximum is 16*sqrt(2) = 22.63
INDEX_PAD = 800           # internal units used by the route picker


def internal(value: float, origin: int) -> int:
    return int(round((value + origin) * 10))


def load(path: str):
    raw = open(path, "rb").read()
    data = zlib.decompress(raw)
    if len(data) < 4:
        raise ValueError("short file")
    count = struct.unpack_from("<I", data, 0)[0]
    end = 4 + count * 12
    if count < 1 or end > len(data):
        raise ValueError("bad point count")
    points = [struct.unpack_from("<ffhH", data, 4 + i * 12) for i in range(count)]
    pos = end
    adj = []
    degrees = []
    for i in range(count):
        if pos >= len(data):
            raise ValueError(f"adjacency ended at point {i}")
        degree = data[pos]
        pos += 1
        if pos + degree * 4 > len(data):
            raise ValueError(f"short adjacency at point {i}")
        adj.append(struct.unpack_from("<" + "I" * degree, data, pos))
        degrees.append(degree)
        pos += degree * 4
    if pos != len(data):
        raise ValueError(f"trailing bytes: consumed {pos} of {len(data)}")
    return data, points, adj, degrees


def checks(name: str, points, adj, degrees):
    count = len(points)
    seen = set()
    distances = []
    mutual = 0
    for i, neighbours in enumerate(adj):
        for j in neighbours:
            if j >= count:
                raise ValueError(f"{name}: neighbour {j} out of range at {i}")
            if i in adj[j]:
                mutual += 1
            distances.append(math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]))
            seen.add(i)
            seen.add(j)
    if len(seen) != count:
        raise ValueError(f"{name}: {count - len(seen)} points without any edge")
    if not distances:
        raise ValueError(f"{name}: no edges")
    high = max(distances)
    if high > MAX_EDGE:
        raise ValueError(f"{name}: edge {high:.3f} m exceeds {MAX_EDGE}")
    components = component_sizes(count, adj)
    return {
        "points": count,
        "edges": len(distances),
        "degrees": (min(degrees), max(degrees), sum(degrees) / count),
        "max_edge": high,
        "mutual": mutual,
        "components": components,
    }


def component_sizes(count: int, adj):
    parent = list(range(count))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        a, b = find(a), find(b)
        if a != b:
            parent[b] = a

    for i, ns in enumerate(adj):
        for j in ns:
            union(i, j)
    sizes = Counter(find(i) for i in range(count))
    return sorted(sizes.values(), reverse=True)


def coarsen(points, adj, cell: float):
    cell_id = {}
    sums = []
    for x, z, h, flag in points:
        key = (math.floor(x / cell), math.floor(z / cell))
        cid = cell_id.get(key)
        if cid is None:
            cid = cell_id[key] = len(sums)
            sums.append([0.0, 0.0, 0, 0])
        row = sums[cid]
        row[0] += x
        row[1] += z
        row[2] += h
        row[3] += 1
    edges = set()
    for i, ns in enumerate(adj):
        x, z = points[i][0], points[i][1]
        a = cell_id[(math.floor(x / cell), math.floor(z / cell))]
        for j in ns:
            x2, z2 = points[j][0], points[j][1]
            b = cell_id[(math.floor(x2 / cell), math.floor(z2 / cell))]
            if a != b:
                edges.add((a, b) if a < b else (b, a))
    nodes = []
    for s in sums:
        n = s[3]
        nodes.append((s[0] / n, s[1] / n, int(round(s[2] / n))))
    return nodes, edges


def binary_size(node_count: int, edge_count: int) -> int:
    # header + nodes + offsets + two u16 arcs per undirected edge
    return 24 + node_count * 6 + (node_count + 1) * 4 + edge_count * 4


def choose_cell(points, adj):
    for cell in CELL_CANDIDATES:
        nodes, edges = coarsen(points, adj, cell)
        if len(nodes) < 65_535 and binary_size(len(nodes), len(edges)) <= SIZE_LIMIT:
            return cell, nodes, edges
    raise ValueError("cannot fit the area below the size limit")


def encode(name: str, points, adj, cell: float, nodes, edges):
    min_x = min(internal(x, ORIGIN_X) for x, z, h, f in points)
    min_z = min(internal(z, ORIGIN_Z) for x, z, h, f in points)
    origin_x = (min_x // 10) * 10 - 640
    origin_z = (min_z // 10) * 10 - 640
    order = sorted(range(len(nodes)), key=lambda i: (round(nodes[i][1], 3), round(nodes[i][0], 3)))
    index = {old: new for new, old in enumerate(order)}
    out = bytearray()
    flags = 1 if name in DUNGEONS else 0
    out += b"NVL1" + struct.pack("<BBHiiII", 1, flags, 0, origin_x, origin_z, len(nodes), len(edges) * 2)
    for old in order:
        x, z, h = nodes[old]
        gx = int(round((internal(x, ORIGIN_X) - origin_x) / 10))
        gz = int(round((internal(z, ORIGIN_Z) - origin_z) / 10))
        if not (-32768 <= gx <= 32767 and -32768 <= gz <= 32767 and -32768 <= h <= 32767):
            raise ValueError(f"{name}: node coordinate outside int16")
        out += struct.pack("<hhh", gx, gz, h)
    adjacency = [set() for _ in nodes]
    for a, b in edges:
        aa, bb = index[a], index[b]
        adjacency[aa].add(bb)
        adjacency[bb].add(aa)
    offsets = [0]
    for row in adjacency:
        offsets.append(offsets[-1] + len(row))
    for value in offsets:
        out += struct.pack("<I", value)
    for row in adjacency:
        for value in sorted(row):
            out += struct.pack("<H", value)
    return bytes(out), origin_x, origin_z


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, help="folder with the navNN.dat files")
    parser.add_argument("--repo", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    parser.add_argument("--only", default="")
    args = parser.parse_args()
    out_dir = os.path.join(args.repo, "navdata-lean")
    os.makedirs(out_dir, exist_ok=True)
    files = sorted(glob.glob(os.path.join(args.source, "nav*.dat")))
    if args.only:
        wanted = set(args.only.split(","))
        files = [p for p in files if os.path.basename(p)[:-4] in wanted]
    seen_data = {}
    areas = []
    print(f"source: {args.source}")
    for path in files:
        name = os.path.basename(path)[:-4]
        data, points, adj, degrees = load(path)
        digest = hashlib.sha256(data).hexdigest()
        if digest in seen_data:
            print(f"{name}: duplicate of {seen_data[digest]}, skipped")
            continue
        seen_data[digest] = name
        stats = checks(name, points, adj, degrees)
        if stats["mutual"]:
            raise ValueError(f"{name}: {stats['mutual']} mutual arcs; expected one-copy edges")
        cell, nodes, edges = choose_cell(points, adj)
        # The coarse graph must stay connected exactly where the source was.
        union = list(range(len(nodes)))

        def find(a):
            while union[a] != a:
                union[a] = union[union[a]]
                a = union[a]
            return a

        for a, b in edges:
            ra, rb = find(a), find(b)
            if ra != rb:
                union[rb] = ra
        sizes = Counter(find(i) for i in range(len(nodes)))
        coarse_parts = sorted(sizes.values(), reverse=True)
        if len(coarse_parts) > len(stats["components"]):
            raise ValueError(f"{name}: coarsening split a component ({len(stats['components'])} -> {len(coarse_parts)})")
        blob, origin_x, origin_z = encode(name, points, adj, cell, nodes, edges)
        rev = hashlib.sha256(blob).hexdigest()[:10]
        target = os.path.join(out_dir, name + ".bin")
        open(target, "wb").write(blob)
        xs = [internal(x, ORIGIN_X) for x, z, h, f in points]
        zs = [internal(z, ORIGIN_Z) for x, z, h, f in points]
        areas.append({
            "name": name,
            "file": name + ".bin",
            "minX": min(xs), "maxX": max(xs),
            "minZ": min(zs), "maxZ": max(zs),
            "nodes": len(nodes), "edges": len(edges), "cell": cell,
            "dungeon": name in DUNGEONS, "rev": rev,
            "sourcePoints": stats["points"], "sourceEdges": stats["edges"],
            "components": len(stats["components"]), "bytes": len(blob),
        })
        print(f"{name}: points {stats['points']:,} edges {stats['edges']:,} "
              f"components {len(stats['components'])} maxedge {stats['max_edge']:.2f} "
              f"-> cell {cell:.1f}m nodes {len(nodes):,} edges {len(edges):,} "
              f"bytes {len(blob):,}")
    areas.sort(key=lambda a: a["name"])
    index = {"source": "third-party navigation data", "version": 1, "origin": {"x": ORIGIN_X, "z": ORIGIN_Z},
             "pad": INDEX_PAD, "areas": areas}
    with open(os.path.join(args.repo, "tools", "navdata-areas.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(index, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    js = ["// Generated by tools/convert-navdata.py from third-party navigation data.",
          "// Bounds and sizes only; the route data stays in navdata-lean/ and is loaded on demand.",
          "const NAVDATA_BASE = 'https://raw.githubusercontent.com/corevider/osb/main/navdata-lean/';",
          "const NAVDATA_AREAS = ["]
    for a in areas:
        js.append("  " + json.dumps({
            "name": a["name"], "file": a["file"],
            "minX": a["minX"], "maxX": a["maxX"], "minZ": a["minZ"], "maxZ": a["maxZ"],
            "nodes": a["nodes"], "cell": a["cell"], "dungeon": a["dungeon"], "rev": a["rev"],
        }, separators=(",", ":")) + ",")
    js.append("];")
    with open(os.path.join(args.repo, "lean-navdata-index.js"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(js) + "\n")
    print(f"areas {len(areas)}; total data {sum(a['bytes'] for a in areas):,} bytes")


if __name__ == "__main__":
    main()
