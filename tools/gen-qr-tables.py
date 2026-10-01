"""Regenerate assets/js/qr-tables.js from the reference QR implementation.

Hand-typed capacity tables are a reliable source of silent corruption, so the
encoder reads tables generated from qrcode's authoritative RS block data.

    python3 tools/gen-qr-tables.py > assets/js/qr-tables.js
"""
from qrcode import base, util
from qrcode.constants import (
    ERROR_CORRECT_H, ERROR_CORRECT_L, ERROR_CORRECT_M, ERROR_CORRECT_Q,
)

MAX_VERSION = 20
LEVELS = (ERROR_CORRECT_L, ERROR_CORRECT_M, ERROR_CORRECT_Q, ERROR_CORRECT_H)


def runs_for(version, level):
    blocks = [tuple(b) for b in base.rs_blocks(version, level)]
    runs = []
    for total, data in blocks:
        if runs and runs[-1][1:] == [total, data]:
            runs[-1][0] += 1
        else:
            runs.append([1, total, data])
    return runs


rows = []
for version in range(1, MAX_VERSION + 1):
    rows.append([runs_for(version, level) for level in LEVELS])

body = ",\n".join(
    "  [" + ",".join(
        "[" + ",".join(str(v) for run in entry for v in run) + "]"
        for entry in row
    ) + "]"
    for row in rows
)
assert len(rows) == MAX_VERSION, len(rows)
align = ",\n".join(
    "  " + str(util.PATTERN_POSITION_TABLE[v - 1])
    for v in range(1, MAX_VERSION + 1)
)

print('''/**
 * Generated tables — do not hand-edit.
 *
 * Regenerate with:  python3 tools/gen-qr-tables.py > assets/js/qr-tables.js
 *
 * Layout: RS_BLOCKS[version - 1] = [L, M, Q, H], each a flat list of
 * (count, totalCodewords, dataCodewords) runs describing the interleaving
 * groups for that version and correction level.
 */

export const RS_BLOCKS = [
%s,
];

/** Alignment pattern centre coordinates per version (v1 has none). */
export const ALIGNMENT_CENTRES = [
%s,
];
''' % (body, align))
