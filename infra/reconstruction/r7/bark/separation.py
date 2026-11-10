import numpy as np


def separate_bark(payload):
    """JSON in/out; bounded relative illumination, not measured albedo."""
    def fail(reason):
        return {'ok': False, 'reason': reason}

    required = ('linearRGB', 'confidence', 'illuminationBounds')
    if not isinstance(payload, dict) or any(k not in payload for k in required):
        return fail('missing_evidence')
    try:
        rgb = np.asarray(payload['linearRGB'], dtype=float)
        c = np.asarray(payload['confidence'], dtype=float)
        bounds = np.asarray(payload['illuminationBounds'], dtype=float)
    except (TypeError, ValueError, OverflowError):
        return fail('invalid_input')
    if rgb.ndim != 3 or rgb.shape[-1] != 3:
        return fail('invalid_input')
    h, w, _ = rgb.shape
    if h < 1 or w < 4 or c.shape != (h, w) or bounds.shape != (2,):
        return fail('invalid_input')
    if not all(np.isfinite(a).all() for a in (rgb, c, bounds)):
        return fail('invalid_input')
    lo, hi = bounds
    if not (0 < lo <= 1 <= hi) or np.any((rgb < 0) | (rgb > 1)):
        return fail('invalid_input')
    if np.any((c < 0) | (c > 1)):
        return fail('invalid_input')
    if np.max(np.abs(rgb[:, 0] - rgb[:, -1])) > .02:
        return fail('seam_mismatch')
    lum = rgb @ np.array([.2126, .7152, .0722])
    peak = rgb.max(axis=2)
    good = (lum > 1e-4) & (peak < .995)
    good &= rgb.min(axis=2) >= .02 * peak
    weights = c * good
    # The duplicated UV endpoints together count as one angular sample.
    weights[:, [0, -1]] *= .5
    if np.count_nonzero(weights.sum(axis=0)) < 3:
        return fail('insufficient_evidence')
    theta = np.linspace(0, 2 * np.pi, w)
    x = np.column_stack((np.ones(w), np.cos(theta), np.sin(theta)))
    a = np.broadcast_to(x, (h, w, 3)).reshape(-1, 3)
    y = np.log(np.maximum(lum, 1e-4)).ravel()
    keep = weights.ravel() > 0
    a, y, base = a[keep], y[keep], weights.ravel()[keep]
    rw = base.copy()
    for _ in range(8):
        root = np.sqrt(rw)
        aw = a * root[:, None]
        if np.linalg.matrix_rank(aw) < 3 or np.linalg.cond(aw) > 100:
            return fail('insufficient_angular_support')
        beta = np.linalg.lstsq(aw, y * root, rcond=None)[0]
        residual = np.abs(y - a @ beta)
        rw = base * np.minimum(1.0, .2 / np.maximum(residual, 1e-12))
    # Drop the intercept: continuous-circle geometric-mean illumination is 1.
    log_field = x[:, 1:] @ beta[1:]
    low, high = np.log(lo), np.log(hi)
    limited = (log_field < low - 1e-9) | (log_field > high + 1e-9)
    field = np.exp(np.clip(log_field, low, high))
    corrected = np.where(good[..., None], rgb / field[None, :, None], rgb)
    if np.max(corrected) > 1 + 1e-9:
        return fail('reflectance_out_of_range')
    # Evidence support only, not a statistical probability of true albedo.
    support = c * good * (~limited)[None, :]
    return {
        'ok': True,
        'linearRGB': np.round(corrected, 10).tolist(),
        'illumination': np.round(field, 10).tolist(),
        'confidence': np.round(support, 10).tolist(),
        'limited': limited.tolist(),
    }
