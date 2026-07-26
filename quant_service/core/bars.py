"""Bars container — OHLC as contiguous numpy arrays.

The JS engine passes around arrays of `{time, open, high, low, close, v}` dicts
and re-derives everything per sweep. Here bars live once as columnar arrays, and
a *view* onto bars[:i+1] is free (numpy slices don't copy), which is what makes
replay cheap: 50k historical sweeps become 50k slices, not 50k re-parses.
"""

from __future__ import annotations

import numpy as np


class Bars:
    __slots__ = ("time", "open", "high", "low", "close", "v", "_root", "_off", "_cache")

    def __init__(self, time, open, high, low, close, v=None):  # noqa: A002
        self.time = np.ascontiguousarray(time, dtype=np.int64)
        self.open = np.ascontiguousarray(open, dtype=np.float64)
        self.high = np.ascontiguousarray(high, dtype=np.float64)
        self.low = np.ascontiguousarray(low, dtype=np.float64)
        self.close = np.ascontiguousarray(close, dtype=np.float64)
        n = len(self.time)
        self.v = np.zeros(n) if v is None else np.ascontiguousarray(v, dtype=np.float64)
        self._root = self
        self._off = 0
        self._cache = {}

    def __len__(self) -> int:
        return len(self.time)

    @classmethod
    def from_records(cls, records) -> "Bars":
        """From the JS bar shape: [{time, open, high, low, close, v}, ...]."""
        n = len(records)
        if n == 0:
            return cls([], [], [], [], [], [])
        return cls(
            np.fromiter((r["time"] for r in records), np.int64, n),
            np.fromiter((r["open"] for r in records), np.float64, n),
            np.fromiter((r["high"] for r in records), np.float64, n),
            np.fromiter((r["low"] for r in records), np.float64, n),
            np.fromiter((r["close"] for r in records), np.float64, n),
            np.fromiter((r.get("v", 0) or 0 for r in records), np.float64, n),
        )

    def slice(self, start: int, end: int) -> "Bars":
        """Zero-copy view of [start, end)."""
        out = object.__new__(Bars)
        out.time = self.time[start:end]
        out.open = self.open[start:end]
        out.high = self.high[start:end]
        out.low = self.low[start:end]
        out.close = self.close[start:end]
        out.v = self.v[start:end]
        # views share the root's caches; a window's pivots are the root's, filtered
        out._root = self._root
        out._off = self._off + start
        out._cache = {}
        return out

    def tail(self, n: int) -> "Bars":
        return self.slice(max(0, len(self) - n), len(self))

    def upto(self, target_time: int, max_count: int, tf_sec: int = 0) -> "Bars":
        """The last `max_count` *closed* bars at or before `target_time`.

        Binary search, zero copy. Mirrors sliceUpTo() in lib/telemetry/replay.mjs.

        The Dukascopy archive is left-labeled (scrape_dukascopy.py resamples on the
        bar's OPEN time), so a bar stamped T is still forming until T + tf_sec.
        Admitting it at T hands the caller a finished high/low/close from the
        future — 3h45m of it on H4. tf_sec=0 means "the stamp is the close", which
        is also what the parity fixtures were exported against.
        """
        end = int(np.searchsorted(self.time, target_time - tf_sec, side="right"))
        if end <= 0:
            return self.slice(0, 0)
        return self.slice(max(0, end - max_count), end)

    def to_records(self) -> list[dict]:
        return [
            {"time": int(t), "open": float(o), "high": float(h), "low": float(l), "close": float(c), "v": float(v)}
            for t, o, h, l, c, v in zip(self.time, self.open, self.high, self.low, self.close, self.v)
        ]
