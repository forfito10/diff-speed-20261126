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
// The empty text has no lines.
export function internLines(text) {
  const parts = text.split('\n');
  const L = parts.length;
  const endedNL = parts[L - 1] === '';
  const count = endedNL ? L - 1 : L;
  const ids = new Int32Array(count);
  const keys = []; // key -> id, index = id
  const map = new Map();
  for (let i = 0; i < count; i++) {
    const s = parts[i];
    const hasNL = i < count - 1 ? 1 : endedNL ? 1 : 0;
    const k = hasNL ? s + '\n' : s;
    let id = map.get(k);
    if (id === undefined) { id = keys.length; map.set(k, id); keys.push(k); }
    ids[i] = id;
  }
  return { ids, keys, endedNL };
}

// The runs of the edit script of a into b (both Int32Array of ids, one id space): [{ kind, count }]
// in order. Myers's greedy search, make.fun's tie-break, no pruning of edge diagonals.
// Nodes (immutablish chain links, one per path step) live in growable typed arrays with refcounts
// and a free list: a discarded path releases its chain, shared tails survive — the same live set
// the reference implementation's garbage collector keeps, without per-node objects.
export function editRuns(a, b) {
  const n = a.length;
  const m = b.length;
  const maxEdit = n + m;
  const offset = maxEdit + 1;
  const EMPTY = -2;
  // slot state: pOld holds oldPos+1 (0 = none consumed), EMPTY when no path sits on the diagonal.
  const pOld = new Int32Array(2 * maxEdit + 3).fill(EMPTY);
  const pLast = new Int32Array(2 * maxEdit + 3).fill(-1);

  // --- growable node pool with refcounts ---
  let cap = 1 << 16;
  let nKind = new Int32Array(cap);
  let nCount = new Int32Array(cap);
  let nPrev = new Int32Array(cap);
  let nRef = new Int32Array(cap);
  const freeList = [];
  const grow = () => {
    const nc = cap << 1;
    const g = (old) => { const t = new Int32Array(nc); t.set(old); return t; };
    nKind = g(nKind); nCount = g(nCount); nPrev = g(nPrev); nRef = g(nRef);
    cap = nc;
  };
  const NEW = (kind, count, prev) => {
    let node;
    if (false && freeList.length > 0) { node = freeList.pop(); }
    else { if (nodes >= cap) grow(); node = nodes++; }
    nKind[node] = kind; nCount[node] = count; nPrev[node] = prev;
    nRef[node] = 1;
    if (prev >= 0) nRef[prev]++;
    return node;
  };
  // Release the chain headed by node (a slot's old head): drop one reference; a node whose
  // count reaches zero is freed, and releases its own previous in turn.
  const release = (node) => {
    while (node >= 0) {
      if (--nRef[node] > 0) return;
      const prev = nPrev[node];
      freeList.push(node);
      node = prev;
    }
  };
  let nodes = 0;

  pOld[offset] = 0; // the start path: oldPos -1 (none consumed), stored +1
  pLast[offset] = -1;

  const oldLen = n;
  const newLen = m;
  const commonExtend = (slot, k) => {
    let oldPos = pOld[slot] - 1;
    let newPos = oldPos - k;
    let common = 0;
    while (newPos + 1 < newLen && oldPos + 1 < oldLen && a[oldPos + 1] === b[newPos + 1]) {
      newPos++; oldPos++; common++;
    }
    if (common > 0) {
      const prevNode = pLast[slot];
      pLast[slot] = NEW(KEEP, common, prevNode);
      if (prevNode >= 0) release(prevNode); // the slot now holds the new head only
    }
    pOld[slot] = oldPos + 1;
    return newPos;
  };

  let newPos = commonExtend(offset, 0);
  if (pOld[offset] - 1 + 1 >= oldLen && newPos + 1 >= newLen) {
    const pairs = [];
    for (let c = pLast[offset]; c !== -1; c = nPrev[c]) pairs.push(nKind[c], nCount[c]);
    return invert(pairs);
  }
  for (let d = 1; d <= maxEdit; d++) {
    for (let k = -d; k <= d; k += 2) {
      const slot = offset + k;
      const rSlot = slot - 1;
      const aSlot = slot + 1;
      const rOld = pOld[rSlot] === EMPTY ? -99 : pOld[rSlot] - 1;
      const aOld = pOld[aSlot] === EMPTY ? -99 : pOld[aSlot] - 1;
      const canRemove = rOld !== -99 && rOld + 1 < oldLen;
      const canAdd = aOld !== -99 && aOld - k < newLen;
      if (!canRemove && !canAdd) {
        if (pLast[slot] >= 0) release(pLast[slot]);
        pOld[slot] = EMPTY; pLast[slot] = -1;
        continue;
      }
      const byDeletion = canRemove ? rOld + 1 : -2;
      const byInsertion = canAdd ? aOld : -2;
      const oldHead = pLast[slot];
      if (byDeletion >= byInsertion) {
        pOld[slot] = rOld + 1 + 1;
        pLast[slot] = NEW(DELETE, 1, pLast[rSlot]);
      } else {
        pOld[slot] = aOld + 1;
        pLast[slot] = NEW(INSERT, 1, pLast[aSlot]);
      }
      if (oldHead >= 0) release(oldHead);
      newPos = commonExtend(slot, k);
      if (pOld[slot] - 1 + 1 >= oldLen && newPos + 1 >= newLen) {
        const pairs = [];
        for (let c = pLast[slot]; c !== -1; c = nPrev[c]) pairs.push(nKind[c], nCount[c]);
        return invert(pairs);
      }
    }
  }
  throw new Error('diff-speed: the search ended without reaching both ends');
}

// runsOut was collected last-first as (kind, count) pairs; reverse into run objects in order.
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
  const a = ta.ids;
  const b = tb.ids;
  const aKeys = ta.keys;
  const bKeys = tb.keys;
  const n = a.length;
  const m = b.length;
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix] && aKeys[a[prefix]] === bKeys[b[prefix]]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix] && aKeys[a[n - 1 - suffix]] === bKeys[b[m - 1 - suffix]]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  if (n - suffix > prefix || m - suffix > prefix) {
    // slice ids for the middle; equality there is int-only (same-id strings may differ across
    // the two texts' tables, but the middle uses ids from each table: we must compare by key).
    const midA = Int32Array.prototype.slice.call(a, prefix, n - suffix);
    const midB = Int32Array.prototype.slice.call(b, prefix, m - suffix);
    // Compare across tables by key: build a merged view. Remap midB ids into a's id space.
    const remap = new Int32Array(midB.length);
    {
      const bKeyToId = new Map();
      for (let i = 0; i < bKeys.length; i++) bKeyToId.set(bKeys[i], i);
      const look = new Map();
      for (let i = 0; i < aKeys.length; i++) look.set(aKeys[i], i);
      for (let i = 0; i < midB.length; i++) {
        const key = bKeys[midB[i]];
        let id = look.get(key);
        if (id === undefined) { id = -(1 + bKeyToId.get(key)); look.set(key, id); }
        remap[i] = id;
      }
    }
    runs.push(...editRuns(midA, remap));
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
      for (let i = 0; i < c.ins; i++) write('+', bKeys[b[c.p + i]]);
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) write('=', aKeys[a[at]]);
  }
  return out.join('');
}
