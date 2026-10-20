/**
 * Side-by-side placement for things that overlap in time — the classic
 * calendar layout.
 *
 * Items are grouped into clusters of transitively overlapping ranges (A meets
 * B, B meets C: one cluster, even if A never meets C). Inside a cluster each
 * item takes the first lane that is free when it starts, and every item in the
 * cluster is drawn 1/lanes wide, so a cluster reads as one block of columns.
 * Ranges that only touch — one ends exactly when the next starts — do not
 * overlap and share a lane.
 *
 * Pure: no React, no dates. Callers pass numbers (minutes, pixels, epoch ms).
 */

export interface LanePlacement {
  /** 0-based column inside the cluster. */
  lane: number;
  /** How many columns the item's cluster needs. */
  lanes: number;
  /** Which cluster the item belongs to; clusters are numbered in time order. */
  cluster: number;
}

export interface Range {
  start: number;
  end: number;
}

/** One placement per input range, in the input's order. */
export function layoutLanes(ranges: Range[]): LanePlacement[] {
  const out: LanePlacement[] = ranges.map(() => ({ lane: 0, lanes: 1, cluster: 0 }));
  // Earliest first; of two starting together, the longer one takes the left lane.
  const order = ranges
    .map((r, i) => ({ i, start: r.start, end: Math.max(r.start, r.end) }))
    .sort((a, b) => a.start - b.start || b.end - a.end || a.i - b.i);

  let cluster = -1;
  let clusterEnd = -Infinity;
  let laneEnds: number[] = [];
  let members: number[] = [];

  const close = () => {
    for (const i of members) out[i]!.lanes = laneEnds.length;
  };

  for (const r of order) {
    // Starting at (or after) the moment the whole cluster has ended: a new cluster.
    if (r.start >= clusterEnd) {
      if (members.length) close();
      cluster += 1;
      clusterEnd = -Infinity;
      laneEnds = [];
      members = [];
    }
    let lane = laneEnds.findIndex((end) => end <= r.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(r.end);
    } else {
      laneEnds[lane] = r.end;
    }
    out[r.i] = { lane, lanes: 1, cluster };
    members.push(r.i);
    clusterEnd = Math.max(clusterEnd, r.end);
  }
  if (members.length) close();
  return out;
}
