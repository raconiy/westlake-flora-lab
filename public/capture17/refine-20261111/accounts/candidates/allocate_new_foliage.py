import hashlib
import heapq
import operator
import numpy as np


def allocate_new_foliage(shoot_xyz, stable_ids, lobe_centers, lobe_radii,
                         frozen_weights, previous_counts, target_total, seed):
    """Allocate zero-based (stable_shoot_id, leaf_ordinal) pairs."""
    p = np.asarray(shoot_xyz, dtype=float)
    ids = np.asarray(stable_ids)
    centers = np.asarray(lobe_centers, dtype=float)
    radii = np.asarray(lobe_radii, dtype=float)
    weights = np.asarray(frozen_weights, dtype=float)
    old = np.asarray(previous_counts)

    if p.ndim != 2 or p.shape[1] != 3:
        raise ValueError("shoot_xyz must have shape (N, 3)")
    n = len(p)
    if ids.ndim != 1 or len(ids) != n:
        raise ValueError("stable_ids must have length N")
    if old.ndim != 1 or len(old) != n or not np.issubdtype(old.dtype, np.integer):
        raise ValueError("previous_counts must be integer-valued")
    if weights.shape != (n,):
        raise ValueError("frozen_weights must have length N")
    if centers.ndim != 2 or centers.shape[1] != 3:
        raise ValueError("lobe_centers must have shape (L, 3)")
    if radii.ndim == 1:
        if len(radii) != len(centers):
            raise ValueError("lobe_radii length mismatch")
        rr = radii[:, None]
    elif radii.ndim == 2 and radii.shape == centers.shape:
        rr = radii
    else:
        raise ValueError("lobe_radii must have shape (L,) or (L, 3)")
    if not all(np.all(np.isfinite(x)) for x in (p, centers, rr, weights)):
        raise ValueError("non-finite numeric input")
    if np.any(rr <= 0) or np.any(weights < 0) or np.any(old < 0):
        raise ValueError("radii, weights, and counts must be nonnegative")
    try:
        target = operator.index(target_total)
        seed = operator.index(seed)
    except TypeError as exc:
        raise TypeError("target_total and seed must be integers") from exc
    if target < int(np.asarray(old, dtype=object).sum()):
        raise ValueError("target_total is smaller than previous total")
    id_values = ids.tolist()
    idkeys = [type(x).__name__ + ":" + repr(x) for x in id_values]
    if len(set(idkeys)) != n:
        raise ValueError("stable_ids must be unique")

    if len(centers):
        with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
            z = (p[:, None, :] - centers[None, :, :]) / rr[None, :, :]
            support = np.exp(-0.5 * np.sum(z * z, axis=2)).sum(axis=1)
    else:
        support = np.zeros(n)
    base = 1e-3 + weights * support
    if not np.all(np.isfinite(base)) or np.any(base <= 0):
        raise ValueError("invalid computed priorities")

    counts = old.astype(np.int64, copy=True)
    added = []
    heap = []

    def push(i, ordinal):
        key = f"{seed}\0{idkeys[i]}\0{ordinal}".encode()
        tie = int.from_bytes(hashlib.blake2b(key, digest_size=8).digest(), "little")
        priority = float(np.log1p(ordinal) - np.log(base[i]))
        heapq.heappush(heap, (priority, tie, idkeys[i], ordinal, i))

    for i in range(n):
        push(i, int(counts[i]))
    need = target - int(np.asarray(old, dtype=object).sum())
    if need and not n:
        raise ValueError("cannot allocate leaves without shoots")
    for _ in range(need):
        _, _, _, ordinal, i = heapq.heappop(heap)
        counts[i] += 1
        added.append((id_values[i], int(ordinal)))
        push(i, int(counts[i]))
    return counts, added
