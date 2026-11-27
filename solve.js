// diff-speed entry: a drop-in for makefun-diff 1.0.0 (MIT). run(input) returns exactly
// makefun-diff 1.0.0's diffPatch answer for { old, new }, computed faster:
// - lines are interned to integer ids with a per-call Map, so Myers compares ints;
// - the greedy search keeps paths in flat typed arrays with a node pool (no per-path objects);
// - the patch writes lines with a known newline flag (no endsWith scan) into one array join.
// The tie-break (deletion wins when both candidates reach one point), the no-pruning search and
// every patch byte follow makefun-diff 1.0.0's rules (the vendor header in the kit's baseline).

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;
const FORMAT = 'makefun-diff/1';
const CONTEXT = 3;

// Tokenize a text into interned line ids. Line i (i < count-1) carries '\n'; the last line
// carries '\n' only when the text ends with '\n' (i.e. the split left a trailing empty part).
// The empty text has no lines. Two maps (with/without the trailing newline) avoid building a
// key string per line: a middle line's part never equals a final line's part across maps.
export function internLines(text) {
  const parts = text.split('\n');
  const L = parts.length;
  const endedNL = parts[L - 1] === '';
  const count = endedNL ? L - 1 : L;
  const ids = new Int32Array(count);
  const keys = []; // id -> the line's text as the patch writes it (newline included when it has one)
  const mapNL = new Map();   // lines that carry '\n'
  const mapEnd = new Map();  // the final line without '\n'
  for (let i = 0; i < count; i++) {
    const s = parts[i];
    const last = i === count - 1;
    const map = last && !endedNL ? mapEnd : mapNL;
    let id = map.get(s);
    if (id === undefined) {
      id = keys.length;
      keys.push(last && !endedNL ? s : s + '\n');
      map.set(s, id);
    }
    ids[i] = id;
  }
  return { ids, keys, endedNL };
}

// The runs of the edit script of a into b (both Int32Array of ids, one id space): [{ kind, count }]
// in order. Myers's greedy search (make.fun's tie-break: the deletion when both candidates reach
// one point; no pruning of edge diagonals), recorded as one furthest-point row per edit count d,
// then walked backwards to the runs: no per-step allocation, one small row per d.
export function editRuns(a, b) {
  const n = a.length;
  const m = b.length;
  const maxEdit = n + m;
  const EMPTY = -2;
  // rows[d][k + d] holds the furthest oldPos+1 on diagonal k after d edits (EMPTY when the
  // diagonal has no path); common runs are already folded in, exactly as the greedy search does.
  const rows = [];
  const rowOf = (d) => rows[d];
  // extend common from (oldPos, newPos), the greedy way; returns the reached oldPos
  const extend = (oldPos, newPos) => {
    while (newPos + 1 < m && oldPos + 1 < n && a[oldPos + 1] === b[newPos + 1]) { newPos++; oldPos++; }
    return oldPos;
  };
  // row 0: the start path on diagonal 0, oldPos -1, then its common run
  {
    const x = extend(-1, -1);
    const r0 = new Int32Array(3);
    r0[1] = x + 1;
    rows.push(r0);
    if (x + 1 >= n && x + 1 >= m) {
      // reached both ends with 0 edits: one KEEP run (x + 1 lines)
      return [{ kind: KEEP, count: x + 1 }];
    }
  }
  let dEnd = -1, kEnd = 0;
  for (let d = 1; d <= maxEdit; d++) {
    const prev = rows[d - 1];
    const row = new Int32Array(2 * d + 3).fill(EMPTY);
    for (let k = -d; k <= d; k += 2) {
      // deletion candidate: diagonal k-1's path consumes one old line
      const sD = (k - 1 >= -(d - 1) && k - 1 <= d - 1) ? prev[k - 1 + (d - 1)] : EMPTY;
      // insertion candidate: diagonal k+1's path consumes one new line
      const sI = (k + 1 >= -(d - 1) && k + 1 <= d - 1) ? prev[k + 1 + (d - 1)] : EMPTY;
      const canD = sD !== EMPTY && sD < n; // oldPos sD-1, after one deletion sD; needs sD < n
      const canI = sI !== EMPTY && (sI - 1) - k < m;
      if (!canD && !canI) continue;
      let x0;
      if (canD && (!canI || sD >= sI - 1)) x0 = sD; // deletion (make.fun's tie-break)
      else x0 = sI - 1; // insertion
      const x = extend(x0, x0 - k);
      row[k + d] = x + 1;
      if (x + 1 >= n && x - k + 1 >= m) { dEnd = d; kEnd = k; break; }
    }
    rows.push(row);
    if (dEnd >= 0) break;
  }
  if (dEnd < 0) throw new Error('diff-speed: the search ended without reaching both ends');
  // Walk backwards: at (d, k, x = oldPos), the greedy search moved from d-1 either by deletion
  // (from k-1, x0 = its stored oldPos + 1) or insertion (from k+1, x0 = its stored oldPos); the
  // chosen candidate is the further one (deletion on a tie), and its common run lands exactly
  // on x — re-derive which, then emit DELETE/INSERT 1 and the KEEP run between.
  const back = [];
  let d = dEnd, k = kEnd, x = rows[dEnd][kEnd + dEnd] - 1;
  while (d > 0) {
    const prev = rows[d - 1];
    const sD = (k - 1 >= -(d - 1) && k - 1 <= d - 1) ? prev[k - 1 + (d - 1)] : EMPTY;
    const sI = (k + 1 >= -(d - 1) && k + 1 <= d - 1) ? prev[k + 1 + (d - 1)] : EMPTY;
    const canD = sD !== EMPTY && sD < n;
    const canI = sI !== EMPTY && (sI - 1) - k < m;
    let byDel = false;
    if (canD && (!canI || sD >= sI - 1)) {
      // verify the deletion's common run lands on x (it must, the search is deterministic)
      if (extend(sD, sD - k) === x) byDel = true;
    }
    if (byDel) {
      const r = x - sD;
      if (r > 0) back.push(KEEP, r);
      back.push(DELETE, 1);
      x = sD - 1; k = k - 1; d = d - 1;
    } else {
      const r = x - (sI - 1);
      if (r > 0) back.push(KEEP, r);
      back.push(INSERT, 1);
      x = sI - 1; k = k + 1; d = d - 1;
    }
  }
  // the d=0 cell: its common run from the start
  const r0 = rows[0][1] - 1;
  if (r0 > 0) back.push(KEEP, r0);
  if (x + 1 !== rows[0][1]) throw new Error('diff-speed: reconstruction mismatch');
  const runs = [];
  for (let i = back.length - 2; i >= 0; i -= 2) runs.push({ kind: back[i], count: back[i + 1] });
  return runs;
}

function invert(pairs) {
  const runs = [];
  for (let i = pairs.length - 2; i >= 0; i -= 2) runs.push({ kind: pairs[i], count: pairs[i + 1] });
  return runs;
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('diff-speed: the input is { old, new }, two strings');
  }
  const ta = internLines(input.old);
  const tb = internLines(input.new);
  const aKeys = ta.keys;
  const bKeys = tb.keys;
  // Remap b's ids into a's id space (a shared key keeps a's id; a b-only key takes a negative
  // id, -(1 + b-key index)), so every later comparison is a single int compare and the common
  // prefix/suffix trim sees the true longest runs.
  const bMap = new Int32Array(tb.ids.length);
  {
    const look = new Map(); // key -> a's id space (a ids >= 0, b-only keys negative)
    for (let i = 0; i < aKeys.length; i++) look.set(aKeys[i], i);
    for (let i = 0; i < bKeys.length; i++) {
      const key = bKeys[i];
      let id = look.get(key);
      if (id === undefined) { id = -(1 + i); look.set(key, id); }
      bMap[i] = id;
    }
  }
  const a = ta.ids;
  const bOrig = tb.ids; // b's own ids, for the patch's line keys
  const b = new Int32Array(tb.ids.length);
  for (let i = 0; i < b.length; i++) b[i] = bMap[tb.ids[i]];
  const n = a.length;
  const m = b.length;
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  if (n - suffix > prefix || m - suffix > prefix) {
    runs.push(...editRuns(Int32Array.prototype.slice.call(a, prefix, n - suffix), Int32Array.prototype.slice.call(b, prefix, m - suffix)));
  }
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  const changes = [];
  let o = 0, p = 0, deleted = 0, inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) { o += r.count; p += r.count; continue; }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) { c = { o, p, dels: 0, ins: 0 }; changes.push(c); }
    if (r.kind === DELETE) { c.dels += r.count; o += r.count; deleted += r.count; }
    else { c.ins += r.count; p += r.count; inserted += r.count; }
  }

  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h === undefined ? undefined : h[h.length - 1];
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  const write = (op, key) => {
    if (key.endsWith('\n')) out.push(op + key);
    else out.push(op + key + '\n%\n');
  };
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) write('=', aKeys[a[at]]);
      for (let i = 0; i < c.dels; i++) write('-', aKeys[a[c.o + i]]);
      for (let i = 0; i < c.ins; i++) write('+', bKeys[bOrig[c.p + i]]);
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) write('=', aKeys[a[at]]);
  }
  return out.join('');
}
