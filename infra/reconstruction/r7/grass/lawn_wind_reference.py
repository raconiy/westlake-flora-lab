import math
import numpy as np


def evaluate_lawn_wind(data):
    """Pure reference: product Y-up, scene metres, delta seconds, radians."""
    if not isinstance(data, dict):
        return {"ok": False, "error": "invalid_input"}
    if "points" not in data or "rootY" not in data:
        return {"ok": False, "error": "missing_evidence: points/rootY"}
    try:
        points = np.asarray(data["points"], dtype=float)
        if points.ndim != 2 or points.shape[1] != 3 or len(points) == 0:
            raise ValueError()
        roots = np.broadcast_to(np.asarray(data["rootY"], dtype=float),
                                (len(points),))
        state = data.get("state", {})
        response = float(state.get("response", 0.0))
        phase = float(state.get("phase", 0.0))
        seconds = float(data.get("seconds", 0.0))
        speed = float(data.get("speed", 0.0))
        values = [response, phase, seconds, speed]
        if not np.isfinite(points).all() or not np.isfinite(roots).all():
            raise ValueError()
        if not all(math.isfinite(v) for v in values):
            raise ValueError()
        if not (-0.8 <= response <= 0.8 and 0 <= phase < 2*math.pi):
            raise ValueError()
        if seconds < 0:
            raise ValueError()
    except (TypeError, ValueError, OverflowError, AttributeError):
        return {"ok": False, "error": "invalid_input"}
    wind = min(12.0, max(-12.0, speed))
    target = wind * abs(wind) / (36.0 + wind*wind)
    if seconds > 0:
        dt = min(seconds, 0.2)
        response += (target-response) * -math.expm1(-dt/0.22)
        if target == 0 and abs(response) < 0.0001:
            response = 0.0
        phase = ((phase+dt*(1.5+0.32*abs(wind))) % (2*math.pi)
                 if response != 0 else 0.0)
    height = np.clip(points[:, 1]-roots, 0.0, 0.09)
    argument = phase-points[:, 0]*1.7-points[:, 2]*0.91
    wave = 0.84+0.16*np.sin(argument)
    slope = response*wave*np.minimum(0.5, 7.0*height)
    lateral = height*slope
    loss = -height*(1.0-np.sqrt(np.maximum(0.0, 1.0-slope*slope)))
    offsets = np.column_stack((0.9745552*lateral, loss,
                               0.2241477*lateral))
    offsets = np.round(offsets, 6)
    offsets[offsets == 0] = 0.0
    return {"ok": True,
            "state": {"response": round(response, 6),
                      "phase": round(phase, 6)},
            "offsets": offsets.tolist()}
